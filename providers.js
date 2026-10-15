/**
 * Provider registry and discovery adapters - the single source of truth
 * for every free-model source.
 *
 * Adding a provider = adding ONE record here (and its discovery adapter if bespoke).
 * Exposes a deep discovery interface: discoverProvider(key) and discoverAllProviders().
 */

const fs = require('node:fs');
const path = require('node:path');
const storage = require('./storage.js');

const STANDARD_PROVIDER_PREFIXES = {
  github: 'gh',
  antigravity: 'ag',
  xai: 'xai',
  'xiaomi-mimo': 'mimo',
  freebuff: 'fb',
  qoder: 'qd',
  'opencode-zen': 'ocz',
  'opencode-go': 'ocg',
  'gemini-cli': 'gc',
  'grok-cli': 'gcli',
  gemini: 'gemini',
  groq: 'groq',
  cerebras: 'cerebras',
  ollama: 'ollama',
  kilocode: 'kc',
  openrouter: 'openrouter',
  nvidia: 'nvidia',
  mistral: 'mistral',
  poolside: 'poolside',
  'cloudflare-ai': 'cloudflare-ai',
  openagentic: 'oa'
};

const PROVIDER_DISPLAY_NAMES = {
  github: 'GitHub Copilot',
  antigravity: 'Antigravity',
  xai: 'xAI Grok',
  'xiaomi-mimo': 'Xiaomi Mimo',
  freebuff: 'Freebuff',
  qoder: 'Qoder',
  'opencode-zen': 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  'gemini-cli': 'Gemini CLI',
  'grok-cli': 'Grok CLI',
  gemini: 'Google Gemini',
  groq: 'Groq',
  cerebras: 'Cerebras',
  ollama: 'Ollama Cloud',
  kilocode: 'Kilo.ai',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA NIM',
  mistral: 'Mistral',
  poolside: 'Poolside',
  'cloudflare-ai': 'Cloudflare Workers AI',
  openagentic: 'OpenAgentic'
};

function getProviderLabel(providerName, prefix, connectionName) {
  const p = String(providerName || '').toLowerCase();
  if (PROVIDER_DISPLAY_NAMES[p]) return PROVIDER_DISPLAY_NAMES[p];
  if (connectionName && connectionName.trim() && !connectionName.includes('@')) return connectionName.trim();
  const raw = p.replace(/-/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const PROVIDERS = [
  {
    key: 'oa', label: 'OpenAgentic', combo: 'openagentic-free',
    prefixes: ['openagentic', 'oa'], usageName: 'openagentic',
    kind: 'openagentic', credentialKind: 'scan',
    baseUrl: 'https://openagentic.id/api/v1',
    matchHosts: ['openagentic.id']
  },
  {
    key: 'kilo', label: 'Kilo.ai', combo: 'kilo-free',
    prefixes: ['kc', 'kilocode'], usageName: 'kilocode',
    kind: 'kilo', connection: 'kilocode', credentialKind: 'kilo',
    baseUrl: 'https://api.kilo.ai/api/gateway'
  },
  {
    key: 'oc', label: 'OpenCode', combo: 'opencode-free',
    prefixes: ['oc', 'opencode'], usageName: 'opencode',
    kind: 'opencode'
  },
  {
    key: 'openrouter', label: 'OpenRouter', combo: 'openrouter-free',
    prefixes: ['openrouter'], usageName: 'openrouter',
    kind: 'openrouter', connection: 'openrouter', credentialKind: 'default',
    baseUrl: 'https://openrouter.ai/api/v1', requireApiKey: false
  },
  {
    key: 'poolside', label: 'Poolside', combo: 'poolside-free',
    prefixes: ['poolside'], usageName: 'poolside',
    kind: 'poolside', connection: 'poolside', credentialKind: 'default',
    baseUrl: 'https://inference.poolside.ai/v1', readBaseUrlFromConnection: true
  },
  {
    key: 'gemini', label: 'Gemini', combo: 'gemini-free',
    prefixes: ['gemini'], usageName: 'gemini',
    kind: 'gemini', connection: 'gemini', credentialKind: 'default',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
  },
  {
    key: 'ollama', label: 'Ollama Cloud', combo: 'ollama-free',
    prefixes: ['ollama'], usageName: 'ollama',
    kind: 'ollama', connection: 'ollama', credentialKind: 'default',
    baseUrl: 'https://api.ollama.com/v1', readBaseUrlFromConnection: true,
    solo: true
  },
  {
    key: 'airforce', label: 'API.airforce', combo: 'airforce-free',
    prefixes: ['api-airforce', 'airforce'], usageName: 'api-airforce',
    kind: 'airforce', connection: 'api-airforce', credentialKind: 'default',
    baseUrl: 'https://api.airforce/v1', readBaseUrlFromConnection: true,
    solo: true, throttleMs: 1200
  },
  {
    key: 'bazaarlink', label: 'Bazaarlink', combo: 'bazaarlink-free',
    prefixes: ['bazaarlink', 'bzl'], usageName: 'bazaarlink',
    kind: 'bazaarlink', connection: 'bazaarlink', credentialKind: 'default',
    baseUrl: 'https://bazaarlink.ai/api/v1', readBaseUrlFromConnection: true
  },
  {
    key: 'bai', label: 'B.ai', combo: 'b.ai-free',
    prefixes: ['b-ai', 'b.ai', 'bai'], usageName: 'b.ai',
    kind: 'bai', connection: 'b.ai', credentialKind: 'bai',
    baseUrl: 'https://api.b.ai/v1'
  },
  {
    key: 'groq', label: 'Groq', combo: 'groq-free',
    prefixes: ['groq'], usageName: 'groq',
    kind: 'openai-compatible', connection: 'groq', credentialKind: 'default',
    baseUrl: 'https://api.groq.com/openai/v1',
    skipPatterns: ['whisper', 'tts', 'guard', 'embed', 'playai']
  },
  {
    key: 'cerebras', label: 'Cerebras', combo: 'cerebras-free',
    prefixes: ['cerebras'], usageName: 'cerebras',
    kind: 'openai-compatible', connection: 'cerebras', credentialKind: 'default',
    baseUrl: 'https://api.cerebras.ai/v1',
    skipPatterns: ['embed']
  },
  {
    key: 'mistral', label: 'Mistral', combo: 'mistral-free',
    prefixes: ['mistral'], usageName: 'mistral',
    kind: 'openai-compatible', connection: 'mistral', credentialKind: 'default',
    baseUrl: 'https://api.mistral.ai/v1',
    skipPatterns: ['embed', 'moderation', 'ocr', 'tts', 'voxtral', 'mistral-saba']
  },
  {
    key: 'cloudflare', label: 'Cloudflare Workers AI', combo: 'cloudflare-free',
    prefixes: ['cloudflare-ai', 'cloudflare', 'cf'], usageName: 'cloudflare',
    kind: 'cloudflare', connection: 'cloudflare-ai', credentialKind: 'cloudflare'
  },
  {
    key: 'nvidia', label: 'NVIDIA NIM', combo: 'nvidia-free',
    prefixes: ['nvidia', 'nim'], usageName: 'nvidia',
    kind: 'openai-compatible', connection: 'nvidia', credentialKind: 'default',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    skipPatterns: [
      'embed', 'bge-m3', 'arctic', 'rerank', 'retriever', 'parse',
      'tts', 'speech', 'audio', 'asr', 'riva', 'parakeet', 'whisper',
      'vision', '-vl', 'vlm', 'fuyu', 'kosmos', 'neva', 'vila', 'deplot', 'clip', 'diffusion', 'image', 'video', 'detector',
      'guard', 'safety', 'topic-control', 'reward', 'moderation'
    ]
  }
];

const PROVIDER_BY_KEY = Object.fromEntries(PROVIDERS.map(p => [p.key, p]));

function providerByPrefix(prefix) {
  const head = String(prefix || '').toLowerCase();
  const found = PROVIDERS.find(p => p.prefixes.includes(head));
  if (found) return found;

  const activeConns = storage.readActiveProviderConnections ? storage.readActiveProviderConnections() : [];
  for (const conn of activeConns) {
    const prov = String(conn.provider || '').toLowerCase();
    const p = String(conn.prefix || STANDARD_PROVIDER_PREFIXES[prov] || prov).toLowerCase();
    if (p === head || prov === head) {
      return {
        key: p,
        label: getProviderLabel(prov, p, conn.name),
        combo: `${p}-free`,
        prefixes: [p, prov],
        usageName: prov,
        kind: '9router-active'
      };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Internal Credential Resolution
// ----------------------------------------------------------------------------

function getProviderCredentials(recordOrKey) {
  const record = typeof recordOrKey === 'string' ? PROVIDER_BY_KEY[recordOrKey] : recordOrKey;
  if (!record) return { apiKey: null, baseUrl: '', prefix: '' };

  if (record.credentialKind === 'scan') return scanConnectionCredentials(record);
  if (record.credentialKind === 'kilo') return kiloConnectionCredentials(record);
  if (record.credentialKind === 'bai') return baiConnectionCredentials(record);
  if (record.credentialKind === 'cloudflare') return cloudflareConnectionCredentials();

  const parsed = record.connection ? storage.readProviderConnection(record.connection) : null;
  return {
    apiKey: parsed?.apiKey || null,
    prefix: parsed?.providerSpecificData?.prefix || record.prefixes[0],
    baseUrl: (record.readBaseUrlFromConnection && parsed?.providerSpecificData?.baseUrl) || record.baseUrl
  };
}

function scanConnectionCredentials(record) {
  const connections = storage.readAllProviderConnections();
  for (const { data } of connections) {
    if (!data) continue;
    const baseUrl = data?.providerSpecificData?.baseUrl || data?.baseUrl || '';
    const matchesHost = (record.matchHosts || []).some(host => baseUrl.includes(host));
    if (matchesHost) {
      return {
        apiKey: data.apiKey || null,
        prefix: data?.providerSpecificData?.prefix || record.prefixes[0],
        baseUrl: baseUrl || record.baseUrl
      };
    }
  }
  return { apiKey: null, prefix: record.prefixes[0], baseUrl: record.baseUrl };
}

function kiloConnectionCredentials(record) {
  const parsed = storage.readProviderConnection(record.connection);
  const token = parsed?.accessToken || parsed?.apiKey || null;
  if (token) {
    return { accessToken: token, apiKey: token, prefix: 'kc', baseUrl: record.baseUrl, gatewayUrl: record.baseUrl };
  }
  return { accessToken: null, apiKey: null, prefix: 'kc', baseUrl: record.baseUrl, gatewayUrl: record.baseUrl };
}

function baiConnectionCredentials(record) {
  const native = storage.readProviderConnection(record.connection);
  if (native && native.apiKey) {
    return {
      apiKey: native.apiKey,
      baseUrl: native?.providerSpecificData?.baseUrl || record.baseUrl,
      prefix: native?.providerSpecificData?.prefix || 'b.ai'
    };
  }

  const connections = storage.readAllProviderConnections();
  for (const { provider, data } of connections) {
    const p = String(provider || '').toLowerCase();
    const specific = data?.providerSpecificData || {};
    const baseUrl = specific.baseUrl || data?.baseUrl || '';
    if ((p.startsWith('openai-compatible') && baseUrl.includes('api.b.ai')) || p.includes('b.ai') || p.includes('b-ai')) {
      if (data?.apiKey) {
        return {
          apiKey: data.apiKey,
          baseUrl: baseUrl || record.baseUrl,
          prefix: specific.prefix || 'b.ai'
        };
      }
    }
  }
  return { apiKey: null, baseUrl: record.baseUrl, prefix: 'b.ai' };
}

function cloudflareConnectionCredentials() {
  const connections = storage.readAllProviderConnections();
  for (const { provider, data } of connections) {
    const p = String(provider || '').toLowerCase();
    if (p === 'cloudflare-ai') {
      const accountId = data?.providerSpecificData?.accountId || null;
      if (data?.apiKey && accountId) {
        return { apiKey: data.apiKey, accountId, prefix: 'cloudflare-ai', baseUrl: '' };
      }
    }
  }

  for (const { provider, data } of connections) {
    const p = String(provider || '').toLowerCase();
    if (!p.startsWith('openai-compatible')) continue;
    const baseUrl = data?.providerSpecificData?.baseUrl || '';
    if (baseUrl.includes('api.cloudflare.com')) {
      const accountMatch = baseUrl.match(/accounts\/([^/]+)/);
      return {
        apiKey: data?.apiKey || null,
        accountId: accountMatch ? accountMatch[1] : null,
        prefix: data?.providerSpecificData?.prefix || 'cloudflare-ai',
        baseUrl
      };
    }
  }
  return { apiKey: null, accountId: null, prefix: 'cloudflare-ai', baseUrl: '' };
}

// ----------------------------------------------------------------------------
// Internal HTTP Clients and Discovery Adapters
// ----------------------------------------------------------------------------

async function scrapeFreeModelsFromWeb() {
  const freeModels = [];
  try {
    console.log('[-] Scraping OpenAgentic.id web for free tier models...');
    const res = await fetch('https://openagentic.id/models', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const rows = html.split(/<tr[^>]*>/);
    for (const row of rows) {
      if (/free/i.test(row)) {
        const idMatch = row.match(/data-model-id=["']([^"']+)["']/) || row.match(/<code>([^<]+)<\/code>/);
        const nameMatch = row.match(/<td[^>]*>([^<]+)<\/td>/);
        if (idMatch && idMatch[1]) {
          freeModels.push({
            id: idMatch[1].trim(),
            name: (nameMatch && nameMatch[1]) ? nameMatch[1].trim() : idMatch[1].trim(),
            source: 'web-free'
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[!] OpenAgentic web scrape notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchFreeModelsFromApi(apiKey, baseUrl) {
  const freeModels = [];
  if (!apiKey) return freeModels;
  try {
    console.log('[-] Fetching free models from OpenAgentic.id API (/v1/models)...');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || '';
      const pricing = m.pricing || {};
      const isFree = id.endsWith(':free') ||
        (pricing.prompt === 0 && pricing.completion === 0) ||
        m.is_free === true;
      if (isFree && id) {
        freeModels.push({
          id,
          name: m.name || id,
          source: 'api-free',
          contextLength: Number(m.context_length || m.max_context_length || 0) || undefined
        });
      }
    }
  } catch (err) {
    console.warn(`[!] OpenAgentic API fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchKiloFreeModels(accessToken, gatewayUrl) {
  const freeModels = [];
  try {
    console.log('[-] Fetching free models from Kilo.ai Gateway (/api/gateway/models)...');
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch(`${gatewayUrl}/models`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || '';
      const pricing = m.pricing || {};
      const promptCost = Number(pricing.prompt ?? -1);
      const isFree = id.endsWith(':free') || (promptCost === 0) || m.is_free === true;
      if (isFree && id) {
        freeModels.push({
          id,
          name: m.name || id,
          source: 'kilo-free',
          contextLength: Number(m.context_length || m.max_context_length || 0) || undefined
        });
      }
    }
  } catch (err) {
    console.warn(`[!] Kilo.ai fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchOpenRouterFreeModels(apiKey, baseUrl = 'https://openrouter.ai/api/v1') {
  const freeModels = [];
  try {
    console.log('[-] Fetching free models from OpenRouter API (/api/v1/models)...');
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || [];
    for (const m of models) {
      const id = m.id || '';
      const pricing = m.pricing || {};
      const promptCost = Number(pricing.prompt ?? -1);
      const isFree = id.endsWith(':free') || (promptCost === 0) || m.is_free === true;
      if (isFree && id) {
        freeModels.push({
          id,
          name: m.name || id,
          source: 'openrouter-free',
          contextLength: Number(m.context_length || m.max_context_length || 0) || undefined
        });
      }
    }
  } catch (err) {
    console.warn(`[!] OpenRouter fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchPoolsideFreeModels(apiKey, baseUrl = 'https://inference.poolside.ai/v1') {
  const freeModels = [];
  if (!apiKey) return freeModels;
  try {
    console.log('[-] Fetching free models from Poolside API (/v1/models)...');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || '';
      if (id) {
        freeModels.push({
          id,
          name: m.name || id,
          source: 'poolside-free',
          contextLength: Number(m.context_length || m.max_context_length || 0) || undefined
        });
      }
    }
  } catch (err) {
    console.warn(`[!] Poolside fetch notice: ${err.message}`);
  }
  return freeModels;
}

function getOpenCodeFreeModels() {
  try {
    console.log('[-] Extracting OpenCode free models directly from 9router...');
    const baseOcFree = [
      'oc/mimo-v2.5-free',
      'oc/laguna-s-2.1-free',
      'oc/deepseek-v4-flash-free',
      'oc/qwen3.6-plus-free',
      'oc/minimax-m3-free',
      'oc/nemotron-3-ultra-free',
      'oc/ling-3.0-flash-free',
      'oc/north-mini-code-free'
    ];
    return {
      prefix: 'oc',
      models: baseOcFree.map(fullId => ({
        id: fullId.replace(/^oc\//, ''),
        fullId: fullId,
        name: `OpenCode ${fullId.replace(/^oc\//, '').toUpperCase()}`,
        source: 'opencode-9router',
        contextLength: 131072
      }))
    };
  } catch (err) {
    console.warn(`[!] OpenCode extraction notice: ${err.message}`);
    return { prefix: 'oc', models: [] };
  }
}

async function fetchGeminiFreeModels(apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta') {
  const freeModels = [];
  if (!apiKey) return freeModels;
  try {
    console.log('[-] Fetching model list from Google Gemini API (/v1beta/models)...');
    const cleanKey = apiKey.trim();
    const separator = baseUrl.includes('?') ? '&' : '?';
    const endpoint = `${baseUrl}/models${separator}key=${cleanKey}`;
    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.models || [];
    for (const m of models) {
      const rawName = m.name || '';
      const id = rawName.replace(/^models\//, '');
      const lower = id.toLowerCase();
      const methods = m.supportedGenerationMethods || [];
      if (!methods.includes('generateContent')) continue;
      if (lower.includes('embedding') || lower.includes('aqa') || lower.includes('imagen')) continue;
      if (id) {
        freeModels.push({
          id,
          name: m.displayName || id,
          source: 'gemini-api-free',
          contextLength: Number(m.inputTokenLimit || 0) || undefined
        });
      }
    }
  } catch (err) {
    console.warn(`[!] Gemini fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchOllamaFreeModels(apiKey, baseUrl = 'https://api.ollama.com/v1') {
  const freeModels = [];
  if (!apiKey) return freeModels;
  try {
    console.log('[-] Fetching model list from Ollama Cloud API (/v1/models)...');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || m.name || '';
      if (!id) continue;
      const lower = id.toLowerCase();
      if (/embed|image|vision|ocr|tts|rerank|guard/.test(lower)) continue;
      freeModels.push({
        id,
        name: m.name || id,
        source: 'ollama-api-free',
        contextLength: Number(m.context_length || 0) || undefined
      });
    }
  } catch (err) {
    console.warn(`[!] Ollama fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchAirforceFreeModels(apiKey, baseUrl = 'https://api.airforce/v1') {
  const freeModels = [];
  try {
    console.log('[-] Fetching free models from API.airforce API (/v1/models)...');
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || '';
      if (!id) continue;
      const lower = id.toLowerCase();
      if (/embed|image|vision|audio|tts|whisper|flux|diffusion|rerank|moderation/.test(lower)) continue;
      freeModels.push({
        id,
        name: m.name || id,
        source: 'airforce-api-free',
        contextLength: Number(m.context_length || 0) || undefined
      });
    }
  } catch (err) {
    console.warn(`[!] API.airforce fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchBazaarlinkFreeModels(apiKey, baseUrl = 'https://bazaarlink.ai/api/v1') {
  const freeModels = [];
  try {
    console.log('[-] Fetching free models from Bazaarlink API (/v1/models)...');
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || '';
      const pricing = m.pricing || {};
      const promptCost = Number(pricing.prompt ?? -1);
      const isFree = id.endsWith(':free') || (promptCost === 0) || m.is_free === true;
      if (isFree && id) {
        freeModels.push({
          id,
          name: m.name || id,
          source: 'bazaarlink-free',
          contextLength: Number(m.context_length || 0) || undefined
        });
      }
    }
  } catch (err) {
    console.warn(`[!] Bazaarlink fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchOpenAiCompatibleFreeModels({ label, apiKey, baseUrl, prefix, skipPatterns = [], freePattern = null, requireApiKey = true }) {
  const freeModels = [];
  if (requireApiKey && !apiKey) {
    console.log(`[⊘] ${label}: no API key/connection found in 9router, skipping (add the connection to enable).`);
    return freeModels;
  }
  if (!baseUrl) {
    console.log(`[⊘] ${label}: no Base URL configured, skipping.`);
    return freeModels;
  }

  try {
    console.log(`[-] Fetching free models from ${label} (/models)...`);
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
    const candidateUrls = [
      `${cleanBaseUrl}/models`,
      cleanBaseUrl.endsWith('/v1') ? `${cleanBaseUrl.replace(/\/v1$/, '')}/models` : `${cleanBaseUrl}/v1/models`,
      cleanBaseUrl
    ];

    let json = null;
    let successfulUrl = null;

    for (const targetUrl of candidateUrls) {
      try {
        const res = await fetch(targetUrl, {
          headers,
          signal: AbortSignal.timeout(15000)
        });
        if (res.ok) {
          json = await res.json();
          successfulUrl = targetUrl;
          break;
        }
      } catch {}
    }

    if (!json) {
      console.warn(`[!] ${label} fetch notice: Endpoint /models not responding on ${cleanBaseUrl}`);
      return freeModels;
    }

    const models = Array.isArray(json) ? json : (json.data || json.models || []);

    const parentMap = new Map();
    const findRoot = x => {
      while (parentMap.get(x) !== x) {
        const next = parentMap.get(parentMap.get(x));
        if (next == null || next === undefined) break;
        parentMap.set(x, next);
        x = next;
      }
      return parentMap.get(x) ?? x;
    };
    const unionIds = (a, b) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) parentMap.set(ra, rb);
    };
    const ensureId = x => { if (!parentMap.has(x)) parentMap.set(x, x); };

    const modelById = new Map();
    for (const m of models) {
      const id = String(m.id || m.name || m.model || '').toLowerCase();
      if (!id) continue;
      ensureId(id);
      modelById.set(id, m);
      for (const alias of (Array.isArray(m?.aliases) ? m.aliases : [])) {
        const key = String(alias).toLowerCase();
        if (!key) continue;
        ensureId(key);
        unionIds(id, key);
      }
    }

    const representativeOfRoot = new Map();
    const preferCandidate = (candidate, incumbent) => {
      if (!incumbent) return true;
      const candidateLatest = candidate.endsWith('-latest');
      const incumbentLatest = incumbent.endsWith('-latest');
      if (candidateLatest !== incumbentLatest) return candidateLatest;
      return candidate.length < incumbent.length;
    };
    for (const id of modelById.keys()) {
      const root = findRoot(id);
      if (preferCandidate(id, representativeOfRoot.get(root))) {
        representativeOfRoot.set(root, id);
      }
    }
    const keepIds = new Set(representativeOfRoot.values());

    const seenIds = new Set();
    for (const m of models) {
      const id = m.id || m.name || m.model || '';
      if (!id || seenIds.has(id)) continue;
      const name = m.name || m.summary || id;
      const lowerId = id.toLowerCase();

      if (skipPatterns.some(pat => lowerId.includes(pat))) continue;

      // If freePattern is specified (e.g. ":free"), enforce it
      if (freePattern && !lowerId.includes(freePattern.toLowerCase()) && m.is_free !== true) {
        continue;
      }

      if (!keepIds.has(lowerId)) continue;
      seenIds.add(id);

      freeModels.push({
        id,
        name,
        source: `${prefix}-api-free`,
        contextLength: Number(m.context_window || m.context_length || m.max_context_length || 0) || undefined
      });
    }
  } catch (err) {
    console.warn(`[!] ${label} fetch notice: ${err.message}`);
  }
  return freeModels;
}

async function fetchCloudflareFreeModels(creds) {
  const freeModels = [];
  if (!creds.apiKey || !creds.accountId) {
    console.log('[⊘] Cloudflare Workers AI: no "cloudflare-ai" connection found in 9router, skipping.');
    console.log('    Add one in 9router (provider "Cloudflare", API token + Account ID from dash.cloudflare.com).');
    return freeModels;
  }

  try {
    console.log('[-] Fetching free models from Cloudflare Workers AI (models/search)...');
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/models/search`;
    const perPage = 100;

    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${endpoint}?task=${encodeURIComponent('Text Generation')}&per_page=${perPage}&page=${page}`, {
        headers: { 'Authorization': `Bearer ${creds.apiKey}`, 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) {
        console.warn(`[!] Cloudflare models/search notice: HTTP ${res.status}`);
        break;
      }

      const json = await res.json();
      const models = json.data || json.result || [];

      for (const m of models) {
        const id = m.name || '';
        if (!id) continue;
        const lowerId = id.toLowerCase();
        if (/embed|image|audio|speech|tts|whisper|flux|diffusion|rerank|guard|moderation/.test(lowerId)) continue;

        const props = Object.fromEntries((Array.isArray(m.properties) ? m.properties : [])
          .map(prop => [prop.property_id, prop.value]));

        const hasPrice = Array.isArray(props.price) && props.price.length > 0;
        const needsPaid = String(props.require_workers_paid) === 'true';
        if (hasPrice || needsPaid) continue;

        freeModels.push({
          id,
          name: m.name || id,
          source: 'cloudflare-workersai-free',
          contextLength: Number(props.context_window || 0) || undefined
        });
      }

      if (models.length < perPage) break;
    }
  } catch (err) {
    console.warn(`[!] Cloudflare models/search notice: ${err.message}`);
  }
  return freeModels;
}

// ----------------------------------------------------------------------------
// Deep Discovery Adapters & Dispatch
// ----------------------------------------------------------------------------

const PROVIDER_DISCOVERY_MAP = {
  openagentic: async record => {
    const creds = getProviderCredentials(record);
    const [web, api] = await Promise.all([
      scrapeFreeModelsFromWeb(),
      fetchFreeModelsFromApi(creds.apiKey, creds.baseUrl)
    ]);
    const modelMap = new Map();
    for (const m of api) modelMap.set(m.id, m);
    for (const m of web) {
      if (!modelMap.has(m.id)) modelMap.set(m.id, m);
    }
    const baselineFreeIds = ['hy3-free', 'nemotron-3-ultra-free', 'mimo-v2.5-free'];
    for (const id of baselineFreeIds) {
      if (!modelMap.has(id)) {
        modelMap.set(id, { id, name: id, source: 'oa-baseline' });
      }
    }
    return { prefix: creds.prefix || 'openagentic', models: Array.from(modelMap.values()) };
  },

  kilo: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchKiloFreeModels(creds.accessToken, creds.gatewayUrl);
    return { prefix: creds.prefix || 'kc', models };
  },

  opencode: () => getOpenCodeFreeModels(),

  openrouter: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchOpenRouterFreeModels(creds.apiKey, creds.baseUrl);
    return { prefix: creds.prefix || 'openrouter', models };
  },

  poolside: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchPoolsideFreeModels(creds.apiKey, creds.baseUrl);
    return { prefix: creds.prefix || 'poolside', models };
  },

  gemini: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchGeminiFreeModels(creds.apiKey, creds.baseUrl);
    return { prefix: creds.prefix || 'gemini', models };
  },

  ollama: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchOllamaFreeModels(creds.apiKey, creds.baseUrl);
    return { prefix: creds.prefix || 'ollama', models };
  },

  airforce: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchAirforceFreeModels(creds.apiKey, creds.baseUrl);
    return { prefix: creds.prefix || 'api-airforce', models };
  },

  bazaarlink: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchBazaarlinkFreeModels(creds.apiKey, creds.baseUrl);
    return { prefix: creds.prefix || 'bazaarlink', models };
  },

  bai: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchOpenAiCompatibleFreeModels({
      label: 'B.ai', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
      skipPatterns: ['tts', 'embed', 'image', 'whisper', 'diffusion', 'rerank', 'guard', 'audio', 'speech']
    });
    return { prefix: creds.prefix || 'b.ai', models };
  },

  cloudflare: async () => {
    const creds = cloudflareConnectionCredentials();
    const models = await fetchCloudflareFreeModels(creds);
    return { prefix: creds.prefix || 'cloudflare-ai', models };
  },

  'openai-compatible': async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchOpenAiCompatibleFreeModels({
      label: record.label, apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix,
      skipPatterns: record.skipPatterns || [], requireApiKey: record.requireApiKey !== false
    });
    return { prefix: creds.prefix || record.prefixes[0], models };
  }
};

/**
 * Discover all providers and models that are active in the 9router deployment.
 * Queries 9router /v1/models and active provider connections from SQLite.
 */
async function discover9routerActiveProviders(options = {}) {
  const activeConns = storage.readActiveProviderConnections ? storage.readActiveProviderConnections() : [];
  if (!activeConns || activeConns.length === 0) return {};

  const activeByPrefix = new Map();
  const activeByProvider = new Map();
  for (const conn of activeConns) {
    const prov = String(conn.provider || '').toLowerCase();
    const prefix = String(conn.prefix || STANDARD_PROVIDER_PREFIXES[prov] || prov).toLowerCase();
    activeByPrefix.set(prefix, conn);
    activeByProvider.set(prov, conn);
  }

  let modelsList = [];
  try {
    const routerUrl = storage.resolveNineRouterUrl();
    const res = await fetch(`${routerUrl}/v1/models`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const json = await res.json();
      modelsList = json.data || json.models || [];
    }
  } catch (err) {
    try {
      const catPath = path.join(storage.NINE_ROUTER_DIR, 'model-catalog.json');
      if (fs.existsSync(catPath)) {
        const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
        modelsList = Object.entries(cat.models || {}).map(([id, meta]) => ({
          id: id.replace(':', '/'),
          capabilities: meta
        }));
      }
    } catch {}
  }

  const NON_TEXT_PATTERNS = [
    'embed', 'tts', 'whisper', 'audio', 'speech', 'flux', 'diffusion',
    'rerank', 'guard', 'moderation', 'asr', 'riva', 'parakeet', 'vision-only',
    'search-a', 'search-b', 'search-c', 'exec-agent', 'trajectory-compaction'
  ];

  const results = {};

  for (const conn of activeConns) {
    const prov = String(conn.provider || '').toLowerCase();
    const prefix = conn.prefix || STANDARD_PROVIDER_PREFIXES[prov] || prov;
    const key = prefix;
    const existingRec = PROVIDERS.find(p => p.key === key || p.prefixes.includes(prefix) || p.prefixes.includes(prov));
    const combo = existingRec?.combo || `${prefix}-free`;
    if (!results[key]) {
      results[key] = {
        key,
        prefix,
        label: existingRec?.label || getProviderLabel(prov, prefix, conn.name),
        combo,
        provider: prov,
        models: [],
        isActive: true,
        source: '9router'
      };
    }
  }

  const seenFullIds = new Set();
  for (const m of modelsList) {
    const id = String(m.id || '');
    if (!id || seenFullIds.has(id)) continue;
    if (m.owned_by === 'combo' || id === 'free' || id.startsWith('my9model-') || id.endsWith('-free')) {
      continue;
    }

    const slashIdx = id.indexOf('/');
    const colonIdx = id.indexOf(':');
    let prefix = '';
    let modelId = '';

    if (slashIdx !== -1) {
      prefix = id.slice(0, slashIdx).toLowerCase();
      modelId = id.slice(slashIdx + 1);
    } else if (colonIdx !== -1) {
      prefix = id.slice(0, colonIdx).toLowerCase();
      modelId = id.slice(colonIdx + 1);
    } else if (m.owned_by) {
      prefix = String(m.owned_by).toLowerCase();
      modelId = id;
    }

    const conn = activeByPrefix.get(prefix) || activeByProvider.get(prefix);
    if (!conn) continue; // skip models belonging to inactive providers or unconfigured providers

    const lowerId = id.toLowerCase();
    if (NON_TEXT_PATTERNS.some(pat => lowerId.includes(pat))) continue;

    const targetKey = conn.prefix || prefix;
    const existingRec = PROVIDERS.find(p => p.key === targetKey || p.prefixes.includes(targetKey));
    const combo = existingRec?.combo || `${targetKey}-free`;

    if (!results[targetKey]) {
      results[targetKey] = {
        key: targetKey,
        prefix: targetKey,
        label: existingRec?.label || getProviderLabel(conn.provider, targetKey, conn.name),
        combo,
        provider: conn.provider,
        models: [],
        isActive: true,
        source: '9router'
      };
    }

    seenFullIds.add(id);

    const caps = m.capabilities || {};
    const contextLength = Number(m.context_length || caps.contextWindow || 0) || undefined;
    const toolsUnsupported = caps.tools === false;
    const reasoning = Boolean(caps.reasoning);

    results[targetKey].models.push({
      id: modelId,
      fullId: id.includes('/') ? id : `${targetKey}/${id}`,
      name: m.name || modelId,
      source: `${targetKey}-9router`,
      contextLength,
      toolsUnsupported,
      reasoning
    });
  }

  return results;
}

/**
 * Deep discovery interface: discover free model candidates for a single provider.
 */
async function discoverProvider(recordOrKey) {
  const record = typeof recordOrKey === 'string' ? PROVIDER_BY_KEY[recordOrKey] : recordOrKey;
  if (!record) throw new Error(`Provider not found: ${recordOrKey}`);
  const impl = PROVIDER_DISCOVERY_MAP[record.kind];
  if (!impl) throw new Error(`No discovery implementation for provider kind "${record.kind}"`);
  return impl(record);
}

/**
 * Deep discovery interface: discover free model candidates for all registered providers in parallel.
 * Automatically combines active 9router deployment providers with built-in adapters and dynamic connections.
 */
async function discoverAllProviders(options = {}) {
  const excludedProviders = options.excludedProviders || [];
  const isExcluded = rec => (rec.prefixes || [rec.prefix]).some(p => excludedProviders.includes(p.toLowerCase()));

  const results = {};

  // 1. Discover Active Providers directly from 9router deployment
  try {
    const nineRouterActive = await discover9routerActiveProviders(options);
    for (const [key, p] of Object.entries(nineRouterActive)) {
      if (isExcluded(p) || excludedProviders.includes(key.toLowerCase()) || excludedProviders.includes(p.provider?.toLowerCase())) {
        results[key] = { ...p, models: [], excluded: true };
      } else {
        results[key] = p;
      }
    }
  } catch (err) {
    console.warn(`[!] 9router active provider discovery notice: ${err.message}`);
  }

  // 2. Discover Built-in Providers (only if not already discovered and populated with models from 9router)
  await Promise.all(PROVIDERS.map(async rec => {
    const existing = results[rec.key] || results[rec.prefixes[0]];
    if (existing && existing.models && existing.models.length > 0) {
      return;
    }

    if (isExcluded(rec)) {
      if (!results[rec.key]) {
        results[rec.key] = { prefix: rec.prefixes[0], models: [], excluded: true, label: rec.label, combo: rec.combo };
      }
    } else {
      try {
        const res = await discoverProvider(rec);
        if (results[rec.key]) {
          if (res.models && res.models.length > 0) results[rec.key].models = res.models;
        } else {
          results[rec.key] = { ...res, label: rec.label, combo: rec.combo };
        }
      } catch (err) {
        console.warn(`[!] Failed to discover ${rec.label}: ${err.message}`);
        if (!results[rec.key]) {
          results[rec.key] = { prefix: rec.prefixes[0], models: [], label: rec.label, combo: rec.combo };
        }
      }
    }
  }));

  // 2. Discover Dynamic Providers from 9router Active Connections
  try {
    const dynamicProviders = storage.getDynamicProviders ? storage.getDynamicProviders() : [];
    await Promise.all(dynamicProviders.map(async dp => {
      const isAlreadyHandled = results[dp.key] ||
        results[dp.prefix] ||
        results[dp.provider] ||
        Object.values(results).some(r => (r.prefix && r.prefix === dp.prefix) || (r.provider && r.provider === dp.provider));
      if (isAlreadyHandled) return;

      if (!dp.enabled || isExcluded(dp) || excludedProviders.includes(dp.provider.toLowerCase())) {
        results[dp.key] = { prefix: dp.prefix, models: [], excluded: true, label: dp.label, combo: dp.combo, isDynamic: true };
        return;
      }

      if (!dp.baseUrl) {
        results[dp.key] = { prefix: dp.prefix, models: [], label: dp.label, combo: dp.combo, isDynamic: true };
        return;
      }

      try {
        const models = await fetchOpenAiCompatibleFreeModels({
          label: dp.label,
          apiKey: dp.apiKey,
          baseUrl: dp.baseUrl,
          prefix: dp.prefix,
          skipPatterns: dp.skipPatterns,
          freePattern: dp.freePattern,
          requireApiKey: false
        });
        results[dp.key] = { prefix: dp.prefix, models, label: dp.label, combo: dp.combo, isDynamic: true };
      } catch (err) {
        console.warn(`[!] Failed to discover dynamic provider ${dp.label}: ${err.message}`);
        results[dp.key] = { prefix: dp.prefix, models: [], label: dp.label, combo: dp.combo, isDynamic: true };
      }
    }));
  } catch (err) {
    console.warn(`[!] Dynamic provider discovery notice: ${err.message}`);
  }

  return results;
}

module.exports = {
  PROVIDERS,
  PROVIDER_BY_KEY,
  STANDARD_PROVIDER_PREFIXES,
  PROVIDER_DISPLAY_NAMES,
  getProviderLabel,
  providerByPrefix,
  getProviderCredentials,
  discoverProvider,
  discover9routerActiveProviders,
  discoverAllProviders
};
