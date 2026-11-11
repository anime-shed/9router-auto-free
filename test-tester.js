const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const tester = require('./tester.js');

async function main() {
  console.log('[*] Testing tester.js unit tests...');

  // 1. Error unwrapping test
  {
    const r404 = tester.parseUpstreamFailure(503, 'HTTP 503: [cerebras/qwen-3-32b] [404]: {"message":"Model zai-glm-4.7 is archived"}');
    assert.strictEqual(r404.upstreamStatus, 404, 'Must extract nested 404');
    assert.strictEqual(r404.isDead, true, '404 is dead');
    assert.strictEqual(r404.isRateLimit, false, '404 is not rate limit');

    const r429 = tester.parseUpstreamFailure(503, 'HTTP 503: [gemini/gemini-4-argon] [429]: { "error": { "code": 429, "message": "Resource has been exhausted (e.g. check quota)." } }');
    assert.strictEqual(r429.upstreamStatus, 429, 'Must extract nested 429');
    assert.strictEqual(r429.isRateLimit, true, '429 is rate limit');
    assert.strictEqual(r429.isDead, false, '429 is not dead');

    const r402 = tester.parseUpstreamFailure(503, 'HTTP 503: [ollama/minimax-m3] [402]: {"error":"this model is not included in your plan"}');
    assert.strictEqual(r402.upstreamStatus, 402, 'Must extract nested 402');
    assert.strictEqual(r402.isFatalBillingOrAuth, false, 'Model-level tier error is not fatal to provider');
    assert.strictEqual(r402.isDead, true, '402 model plan error is dead');

    const rSpend = tester.parseUpstreamFailure(503, 'HTTP 503: [xai/grok-4.7] [402]: {"code":"personal-team-blocked:spending-limit"}');
    assert.strictEqual(rSpend.isFatalBillingOrAuth, true, 'Account spending limit is fatal billing');

    const rChannel = tester.parseUpstreamFailure(400, 'HTTP 400: [400]: {"error":{"code":"no_available_channel","message":"The model has no channel"}}');
    assert.strictEqual(rChannel.isFatalBillingOrAuth, false, 'no_available_channel is not fatal to provider');
    assert.strictEqual(rChannel.isDead, true, 'no_available_channel is dead');

    const r401 = tester.parseUpstreamFailure(503, 'HTTP 503: [groq/llama-3] [401]: {"error":"Invalid API key"}');
    assert.strictEqual(r401.upstreamStatus, 401, 'Must extract nested 401');
    assert.strictEqual(r401.isFatalBillingOrAuth, true, '401 is fatal auth');
  }

  // 2. CircuitBreaker test
  {
    const cb = new tester.CircuitBreaker();
    assert.strictEqual(cb.isTripped('test-prov'), false);

    // Consecutive 429s
    const res1 = cb.recordFailure('test-prov', { isRateLimit: true, reason: '429 rate limit' });
    assert.strictEqual(res1.tripped, false);
    assert.strictEqual(res1.backoffMs, 1500);

    const res2 = cb.recordFailure('test-prov', { isRateLimit: true, reason: '429 rate limit' });
    assert.strictEqual(res2.tripped, false);
    assert.strictEqual(res2.backoffMs, 3000);

    const res3 = cb.recordFailure('test-prov', { isRateLimit: true, reason: '429 rate limit' });
    assert.strictEqual(res3.tripped, true);
    assert.strictEqual(cb.isTripped('test-prov'), true);

    // Fatal error trips immediately
    const cbFatal = new tester.CircuitBreaker();
    const resFatal = cbFatal.recordFailure('fatal-prov', { isFatalBillingOrAuth: true, reason: '402 billing limit' });
    assert.strictEqual(resFatal.tripped, true);
    assert.strictEqual(cbFatal.isTripped('fatal-prov'), true);
  }

  // 3. ProviderPacer test
  {
    const pacer = new tester.ProviderPacer();
    const start = Date.now();
    await pacer.acquireToken('groq', 50);
    await pacer.acquireToken('groq', 50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Pacer must enforce delayMs interval (elapsed: ${elapsed}ms)`);
  }

  // 4. Dead models negative cache test
  {
    const dummyStore = { models: {} };
    tester.recordDeadModel('prov/dead-1', '404 not found', 404, dummyStore);
    assert.ok(dummyStore.models['prov/dead-1']);
    assert.strictEqual(dummyStore.models['prov/dead-1'].failCount, 1);
    assert.strictEqual(dummyStore.models['prov/dead-1'].confirmedDead, false);

    // If aged > 7 days and failCount >= 2
    dummyStore.models['prov/dead-1'].firstSeenDead = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    tester.recordDeadModel('prov/dead-1', '404 not found', 404, dummyStore);
    assert.strictEqual(dummyStore.models['prov/dead-1'].confirmedDead, true);

    const confirmed = tester.isModelConfirmedDead('prov/dead-1', dummyStore);
    assert.ok(confirmed, 'Must identify confirmed dead model after 7 days');

    tester.clearDeadModel('prov/dead-1', dummyStore);
    assert.strictEqual(dummyStore.models['prov/dead-1'], undefined, 'Must clear dead model on success');
  }

  // 5. Fallback to /v1/chat/completions on timeout bottleneck
  {
    let endpointCalled = '';
    const mockFetch = async (url, opts) => {
      if (url.includes('/api/models/test')) {
        endpointCalled = '/api/models/test';
        return {
          ok: false,
          status: 500,
          json: async () => ({ ok: false, error: 'The operation was aborted due to timeout' })
        };
      }
      if (url.includes('/v1/chat/completions')) {
        endpointCalled = '/v1/chat/completions';
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: 'hello' } }] })
        };
      }
      throw new Error('Unexpected URL: ' + url);
    };

    const res = await tester.testModelWith9router('nvidia/mistralai/mistral-large-4-1t-a52b', 'dummy-token', {
      fetchImpl: mockFetch,
      apiKey: 'dummy-api-key'
    });

    assert.strictEqual(endpointCalled, '/v1/chat/completions', 'Must fallback to /v1/chat/completions when /api/models/test times out');
    assert.strictEqual(res.valid, true, 'Fallback response must be valid');
    assert.strictEqual(res.viaChatCompletions, true, 'Result should indicate viaChatCompletions');
  }

  console.log('[✓] All tester.js unit tests passed successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});