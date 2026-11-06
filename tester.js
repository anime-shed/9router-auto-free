/**
 * Resilient Rate-Limited Model Tester for 9router-auto-free
 *
 * Implements:
 * 1. Sequential dispatch pacer per provider (no concurrent bursts).
 * 2. Unwrapped upstream error inspection (strips 9router 503 envelope).
 * 3. Discriminative circuit breaker (instant on 401/402, 3-strike backoff on 429).
 * 4. Dead models tracking & 7-day negative cache with atomic persistence.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEAD_MODELS_PATH = path.join(__dirname, 'dead-models.json');
const DEFAULT_TIMEOUT_MS = 45000; // 45 seconds per user requirement
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SUPPRESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // suppress confirmed dead models for 14 days before re-check

// Per-provider rate & concurrency profiles
const PROVIDER_PROFILES = {
  default:        { concurrency: 2, delayMs: 400, maxRetries: 1 },
  // Strict concurrency/rate limit providers:
  aihubmix:       { concurrency: 1, delayMs: 1200, maxRetries: 0 },
  inferera:       { concurrency: 1, delayMs: 1200, maxRetries: 0 },
  groq:           { concurrency: 1, delayMs: 1000, maxRetries: 0 },
  cerebras:       { concurrency: 1, delayMs: 800,  maxRetries: 0 },
  xai:            { concurrency: 1, delayMs: 1500, maxRetries: 0 },
  'grok-cli':     { concurrency: 1, delayMs: 1500, maxRetries: 0 },
  kilocode:       { concurrency: 1, delayMs: 800,  maxRetries: 1 },
  kc:             { concurrency: 1, delayMs: 800,  maxRetries: 1 },
  'opencode-zen': { concurrency: 1, delayMs: 1000, maxRetries: 1 },
  ocz:            { concurrency: 1, delayMs: 1000, maxRetries: 1 },
  'opencode-go':  { concurrency: 2, delayMs: 500,  maxRetries: 1 },
  ocg:            { concurrency: 2, delayMs: 500,  maxRetries: 1 },
  openrouter:     { concurrency: 2, delayMs: 600,  maxRetries: 1 },
  // High-throughput providers:
  ollama:         { concurrency: 2, delayMs: 300,  maxRetries: 1 },
  nvidia:         { concurrency: 2, delayMs: 400,  maxRetries: 1 },
  gemini:         { concurrency: 2, delayMs: 500,  maxRetries: 1 },
  'gemini-cli':   { concurrency: 1, delayMs: 1000, maxRetries: 1 },
  mistral:        { concurrency: 2, delayMs: 500,  maxRetries: 1 },
  'cloudflare-ai':{ concurrency: 2, delayMs: 400,  maxRetries: 1 }
};

function getProviderProfile(prefixOrKey) {
  const k = String(prefixOrKey || '').toLowerCase();
  return PROVIDER_PROFILES[k] || PROVIDER_PROFILES.default;
}

/**
 * Safely persist file with atomic write-rename pattern
 */
function atomicWriteFileSync(filePath, content) {
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.copyFileSync(tmpPath, filePath);
      fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Dead models store management
 */
function loadDeadModels(options = {}) {
  if (options.resetCache || process.argv.includes('--reset-cache') || process.argv.includes('--reset-dead-cache')) {
    return { updatedAt: new Date().toISOString(), models: {} };
  }
  try {
    if (fs.existsSync(DEAD_MODELS_PATH)) {
      const data = JSON.parse(fs.readFileSync(DEAD_MODELS_PATH, 'utf8'));
      return { updatedAt: data.updatedAt, models: data.models || {} };
    }
  } catch {}
  return { updatedAt: new Date().toISOString(), models: {} };
}

function saveDeadModels(store) {
  try {
    atomicWriteFileSync(DEAD_MODELS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      models: store.models || {}
    }, null, 2) + '\n');
  } catch (err) {
    console.warn(`[!] Warning: Could not save dead-models.json: ${err.message}`);
  }
}

function isModelConfirmedDead(fullId, deadStore, suppressionTtlMs = DEFAULT_SUPPRESSION_TTL_MS) {
  if (!deadStore || !deadStore.models) return false;
  const entry = deadStore.models[fullId];
  if (!entry || !entry.confirmedDead) return false;

  const deadTime = new Date(entry.confirmedDeadAt || entry.lastSeenDead).getTime();
  const elapsed = Date.now() - deadTime;
  if (elapsed < suppressionTtlMs) {
    return entry;
  }
  // After suppression TTL, allow re-testing
  entry.confirmedDead = false;
  return false;
}

function recordDeadModel(fullId, reason, status, deadStore, thresholdMs = SEVEN_DAYS_MS) {
  if (!deadStore) return;
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const existing = deadStore.models[fullId];

  if (!existing) {
    deadStore.models[fullId] = {
      firstSeenDead: now,
      lastSeenDead: now,
      status: Number(status) || 404,
      reason: String(reason || '').slice(0, 100),
      failCount: 1,
      confirmedDead: false
    };
  } else {
    existing.lastSeenDead = now;
    existing.failCount = (existing.failCount || 1) + 1;
    existing.reason = String(reason || existing.reason).slice(0, 100);
    existing.status = Number(status) || existing.status;

    const firstMs = new Date(existing.firstSeenDead || now).getTime();
    // Confirmed dead if persistently failing across at least 7 days or repeatedly with 404/410
    if ((nowMs - firstMs >= thresholdMs && existing.failCount >= 2) || (existing.failCount >= 5 && [404, 410].includes(existing.status))) {
      existing.confirmedDead = true;
      if (!existing.confirmedDeadAt) existing.confirmedDeadAt = now;
    }
  }
}

function clearDeadModel(fullId, deadStore) {
  if (deadStore && deadStore.models && deadStore.models[fullId]) {
    delete deadStore.models[fullId];
  }
}

/**
 * Parse and unwrap 9router's error envelope
 */
function parseUpstreamFailure(resStatus, rawError) {
  const text = String(rawError || '').replace(/\s+/g, ' ').trim();

  // Extract nested upstream HTTP status (e.g. "[404]: {"error":...}" or "[429]")
  const bracketMatch = text.match(/\[(\d{3})\]/);
  const httpPrefixMatch = text.match(/HTTP\s+(\d{3})/i);
  let upstreamStatus = bracketMatch ? parseInt(bracketMatch[1], 10)
    : (httpPrefixMatch ? parseInt(httpPrefixMatch[1], 10) : Number(resStatus || 500));

  const isFatalBillingOrAuth = upstreamStatus === 401 || upstreamStatus === 402 ||
    /spending.?limit|balance|payment.?required|unauthorized|invalid.?api.?key|account.?suspended|no_available_channel|insufficient.?quota/i.test(text);

  const isRateLimit = upstreamStatus === 429 ||
    /quota|rate.?limit|resource.?exhaust|concurrency|too many requests|429/i.test(text);

  const isDead = [400, 404, 410].includes(upstreamStatus) ||
    /archived|retired|not.?found|does not exist|not included in your plan|model is not included/i.test(text);

  const isTimeout = /timed?\s*out|abort/i.test(text);

  return {
    upstreamStatus,
    isFatalBillingOrAuth,
    isRateLimit,
    isDead,
    isTimeout,
    reason: text.slice(0, 80)
  };
}

/**
 * Centralized Provider Pacer: ensures requests for a given provider
 * are dispatched with guaranteed minimum interval spacing.
 */
class ProviderPacer {
  constructor() {
    this.lastDispatch = new Map();
  }

  async acquireToken(providerKey, delayMs) {
    if (!delayMs || delayMs <= 0) return;
    const now = Date.now();
    const last = this.lastDispatch.get(providerKey) || 0;
    const targetTime = last + delayMs;

    if (now < targetTime) {
      const waitTime = targetTime - now;
      this.lastDispatch.set(providerKey, targetTime);
      await new Promise(r => setTimeout(r, waitTime));
    } else {
      this.lastDispatch.set(providerKey, now);
    }
  }

  applyBackoff(providerKey, extraDelayMs) {
    const current = this.lastDispatch.get(providerKey) || Date.now();
    this.lastDispatch.set(providerKey, current + extraDelayMs);
  }
}

/**
 * Circuit breaker per provider
 */
class CircuitBreaker {
  constructor() {
    this.state = new Map(); // providerKey -> { consecutive429: 0, tripped: false, reason: '' }
  }

  isTripped(providerKey) {
    return this.state.get(providerKey)?.tripped === true;
  }

  getTripReason(providerKey) {
    return this.state.get(providerKey)?.reason || 'Circuit breaker tripped';
  }

  recordSuccess(providerKey) {
    const s = this.state.get(providerKey);
    if (s && !s.tripped) {
      s.consecutive429 = 0;
    }
  }

  recordFailure(providerKey, failure) {
    let s = this.state.get(providerKey);
    if (!s) {
      s = { consecutive429: 0, tripped: false, reason: '' };
      this.state.set(providerKey, s);
    }

    if (failure.isFatalBillingOrAuth) {
      s.tripped = true;
      s.reason = `Fatal upstream authorization or billing block: ${failure.reason}`;
      return { tripped: true, immediate: true };
    }

    if (failure.isRateLimit) {
      s.consecutive429 += 1;
      if (s.consecutive429 >= 3) {
        s.tripped = true;
        s.reason = `Persistent rate-limit (3 consecutive 429 rejections): ${failure.reason}`;
        return { tripped: true, backoffMs: 0 };
      }
      // Progressive provider backoff: 1.5s, 3s
      const backoffMs = s.consecutive429 * 1500;
      return { tripped: false, backoffMs };
    }

    return { tripped: false };
  }
}

/**
 * Execute a single model test ping against 9router with unwrapped inspection.
 */
async function testModelWith9router(fullModelId, token, options = {}) {
  if (!token) {
    return { valid: true, ok: true, latencyMs: 9999, verdict: 'active', note: '9router token unavailable' };
  }

  const doFetch = options.fetchImpl || fetch;
  const routerUrl = options.routerUrl || (process.env.NINEROUTER_URL || 'http://127.0.0.1:20128').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries != null ? options.maxRetries : 1;
  const attempt = options.attempt || 1;

  const startTime = Date.now();
  try {
    const res = await doFetch(`${routerUrl}/api/models/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-9r-cli-token': token
      },
      body: JSON.stringify({ model: fullModelId, kind: 'llm' }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const latencyMs = Date.now() - startTime;
    const data = await res.json().catch(() => ({}));

    if (data.ok) {
      return { valid: true, ok: true, latencyMs, verdict: 'active', status: 200 };
    }

    const rawError = data.error || `HTTP ${data.status || res.status}`;
    const failure = parseUpstreamFailure(data.status || res.status, rawError);

    // If fatal or dead, NEVER retry
    if ((failure.isFatalBillingOrAuth || failure.isDead) && attempt >= 1) {
      return {
        valid: false,
        ok: false,
        latencyMs,
        status: failure.upstreamStatus,
        reason: failure.reason,
        verdict: 'dead',
        isFatal: failure.isFatalBillingOrAuth,
        isDead: failure.isDead,
        isRateLimit: failure.isRateLimit
      };
    }

    // Rate limit -> classify as quota
    if (failure.isRateLimit) {
      return {
        valid: false,
        ok: false,
        latencyMs,
        status: failure.upstreamStatus,
        reason: failure.reason,
        quotaExhausted: true,
        verdict: 'quota',
        isRateLimit: true
      };
    }

    // Transient failure (502, 503, 504, timeout) -> retry once if attempts remain
    if (attempt <= maxRetries) {
      await new Promise(r => setTimeout(r, 1200));
      const retryRes = await testModelWith9router(fullModelId, token, {
        ...options,
        attempt: attempt + 1
      });
      return { ...retryRes, retried: true };
    }

    return {
      valid: false,
      ok: false,
      latencyMs,
      status: failure.upstreamStatus,
      reason: failure.reason,
      verdict: 'dead',
      timedOut: failure.isTimeout
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const failure = parseUpstreamFailure(504, err.message);

    if (attempt <= maxRetries && !failure.isDead && !failure.isFatalBillingOrAuth) {
      await new Promise(r => setTimeout(r, 1200));
      const retryRes = await testModelWith9router(fullModelId, token, {
        ...options,
        attempt: attempt + 1
      });
      return { ...retryRes, retried: true };
    }

    return {
      valid: false,
      ok: false,
      latencyMs,
      status: failure.upstreamStatus,
      reason: failure.reason,
      verdict: 'dead',
      timedOut: true
    };
  }
}

/**
 * Multi-model test orchestrator with rate profiles, pacer, circuit breaker, and dead model cache.
 */
async function testModels(models, options = {}) {
  const token = options.token;
  const prefix = options.prefix || '';
  const routerUrl = options.routerUrl;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const deadStore = options.deadStore || loadDeadModels(options);

  const profile = getProviderProfile(prefix);
  const concurrency = options.concurrency || profile.concurrency || 1;
  const delayMs = options.delayMs != null ? options.delayMs : profile.delayMs;
  const maxRetries = options.maxRetries != null ? options.maxRetries : profile.maxRetries;

  const pacer = options.pacer || new ProviderPacer();
  const breaker = options.breaker || new CircuitBreaker();

  const active = [];
  const quota = [];
  const dead = [];
  const latencyMap = new Map();
  let circuitTripped = false;
  let tripReason = '';

  const queue = [...models];

  async function worker() {
    while (queue.length > 0) {
      if (breaker.isTripped(prefix)) {
        circuitTripped = true;
        tripReason = breaker.getTripReason(prefix);
        break;
      }

      const item = queue.shift();
      if (!item) break;

      const fullId = typeof item === 'object' ? (item.fullId || `${prefix}/${item.id}`) : String(item);
      const modelObj = typeof item === 'object' ? item : { id: fullId.replace(/^[a-zA-Z0-9_.-]+\//, ''), fullId };

      // Check negative cache
      const deadCacheEntry = isModelConfirmedDead(fullId, deadStore);
      if (deadCacheEntry) {
        console.log(`    [⊘ Dead Cached] ${fullId} -> Unavailable >7d (${deadCacheEntry.reason})`);
        dead.push({ ...modelObj, verdict: 'dead', reason: deadCacheEntry.reason, cachedDead: true });
        continue;
      }

      // Acquire paced dispatch token
      await pacer.acquireToken(prefix, delayMs);

      if (breaker.isTripped(prefix)) {
        circuitTripped = true;
        tripReason = breaker.getTripReason(prefix);
        break;
      }

      const result = await testModelWith9router(fullId, token, {
        routerUrl,
        timeoutMs,
        maxRetries
      });

      if (result.verdict === 'active') {
        breaker.recordSuccess(prefix);
        clearDeadModel(fullId, deadStore);
        active.push({ ...modelObj, latencyMs: result.latencyMs, verdict: 'active' });
        latencyMap.set(fullId, result.latencyMs);
        console.log(`    [✓ Active] ${fullId} (${result.latencyMs}ms)`);
      } else if (result.verdict === 'quota') {
        const breakRes = breaker.recordFailure(prefix, { isRateLimit: true, reason: result.reason });
        if (breakRes.backoffMs > 0) {
          pacer.applyBackoff(prefix, breakRes.backoffMs);
        }
        quota.push({ ...modelObj, latencyMs: 999998, quotaExhausted: true, verdict: 'quota', reason: result.reason });
        console.log(`    [⏳ Quota] ${fullId} -> Kept at bottom (${result.reason})`);
      } else {
        // Dead result
        recordDeadModel(fullId, result.reason, result.status, deadStore);
        const breakRes = breaker.recordFailure(prefix, {
          isFatalBillingOrAuth: result.isFatal,
          isDead: result.isDead,
          reason: result.reason
        });

        dead.push({ ...modelObj, latencyMs: result.latencyMs, verdict: 'dead', reason: result.reason });
        console.log(`    [✗ Dropped] ${fullId} -> ${result.reason}${result.retried ? ' (after retry)' : ''}`);

        if (breakRes.tripped) {
          circuitTripped = true;
          tripReason = breaker.getTripReason(prefix);
          console.log(`    [⚡ Circuit Breaker] Provider [${prefix}] tripped! ${tripReason}. Skipping ${queue.length} remaining candidates.`);
          break;
        }
      }
    }
  }

  const workersCount = Math.min(concurrency, Math.max(1, queue.length));
  const workers = Array.from({ length: workersCount }, () => worker());
  await Promise.all(workers);

  // Persist dead models cache update
  saveDeadModels(deadStore);

  return {
    active,
    quota,
    dead,
    all: [...active, ...quota],
    latencyMap,
    circuitTripped,
    tripReason
  };
}

module.exports = {
  PROVIDER_PROFILES,
  DEAD_MODELS_PATH,
  DEFAULT_TIMEOUT_MS,
  SEVEN_DAYS_MS,
  DEFAULT_SUPPRESSION_TTL_MS,
  getProviderProfile,
  atomicWriteFileSync,
  loadDeadModels,
  saveDeadModels,
  isModelConfirmedDead,
  recordDeadModel,
  clearDeadModel,
  parseUpstreamFailure,
  ProviderPacer,
  CircuitBreaker,
  testModelWith9router,
  testModels
};
