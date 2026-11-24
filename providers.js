/**
 * Provider registry and discovery adapters.
 *
 * provider-registry.json contains ONLY providers with bespoke free-model discovery
 * logic (custom APIs, non-standard auth, web-scraping, :free suffix filtering, etc.).
 *
 * Every other provider that is active in the 9router SQLite providerConnections table
 * is handled generically at runtime: credentials + baseUrl come from SQLite,
 * free models are found by calling GET /v1/models with the stored API key.
 *
 * To add a new provider that only needs standard /v1/models discovery: nothing to do —
 * just add it in the 9router UI.  To add one with special logic: add ONE entry to
 * provider-registry.json and implement its adapter in PROVIDER_DISCOVERY_MAP below.
 */

const fs = require('node:fs');
const path = require('node:path');
const storage = require('./storage.js');

// ---------------------------------------------------------------------------
// Load bespoke-adapter registry + freeOnly guard list from JSON
// ---------------------------------------------------------------------------

const REGISTRY_PATH = path.join(__dirname, 'provider-registry.json');

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    console.error(`[!] Failed to load provider-registry.json: ${err.message}`);
    return { bespoke: [], freeOnly: [] };
  }
}

const _reg = loadRegistry();

/**
 * BESPOKE_PROVIDERS — configs for providers that need special free-model discovery.
 * Shape: { key, connection?, credentialKind?, baseUrl?, modelsUrl?,
 *           matchHosts?, solo?, throttleMs?, freeOnly? }
 * Everything not listed here is auto-discovered from the 9router SQLite at runtime.
 */
const BESPOKE_PROVIDERS = _reg.bespoke || [];
const BESPOKE_BY_KEY = Object.fromEntries(BESPOKE_PROVIDERS.map(p => [p.key, p]));

/**
 * PROVIDERS — back-compat shim for callers that still iterate this.
 * Built entirely from active 9router connections at require-time, augmented with
 * bespoke overrides from the JSON. No hardcoded provider list.
 *
 * Shape per entry: { key, label, combo, prefixes, usageName, kind, ... }
 */
function buildProvidersFromRuntime() {
  const conns = (storage.readActiveProviderConnections ? storage.readActiveProviderConnections() : []);
  const seen = new Set();
  const list = [];

  // 1. Bespoke entries — always included (they may not have a SQLite connection)
  for (const b of BESPOKE_PROVIDERS) {
    seen.add(b.key);
    list.push({
      key:             b.key,
      label:           b.key,       // label resolved at discovery time from connection name
      combo:           `${b.key}-free`,
      prefixes:        [b.key],
      usageName:       b.connection || b.key,
      kind:            b.key,       // kind === key → PROVIDER_DISCOVERY_MAP lookup
      ...(b.connection    && { connection: b.connection }),
      ...(b.credentialKind && { credentialKind: b.credentialKind }),
      ...(b.baseUrl       && { baseUrl: b.baseUrl }),
      ...(b.modelsUrl     && { modelsUrl: b.modelsUrl }),
      ...(b.matchHosts    && { matchHosts: b.matchHosts }),
      ...(b.solo          && { solo: true }),
      ...(b.throttleMs    && { throttleMs: b.throttleMs }),
      ...(b.freeOnly      && { freeOnly: true }),
    });
  }

  // 2. Everything active in SQLite — generic runtime providers
  for (const conn of conns) {
    const prov = String(conn.provider || '').toLowerCase();
    const prefix = conn.prefix || prov.split('-')[0];
    const key = prefix;
    if (seen.has(key) || seen.has(prov)) continue;
    seen.add(key);
    list.push({
      key,
      label:    conn.name || prov,
      combo:    `${key}-free`,
      prefixes: [key, prov].filter((v, i, a) => v && a.indexOf(v) === i),
      usageName: prov,
      kind:     'openai-compatible',
    });
  }
  return list;
}

// Lazily built once — callers that need live data should use discover9routerActiveProviders()
const PROVIDERS = buildProvidersFromRuntime();
const PROVIDER_BY_KEY = Object.fromEntries(PROVIDERS.map(p => [p.key, p]));

// ---------------------------------------------------------------------------
// CANONICAL_CATALOG_MAP  — built from external-models.json at runtime.
// Maps provider key/prefix → catalog key list for external enrichment.
// No hardcoded map here — if a new provider appears in the external catalog
// it is picked up automatically via the catalog's own provider field.
// ---------------------------------------------------------------------------
const CANONICAL_CATALOG_MAP = {};
try {
  const extPath = path.join(__dirname, 'external-models.json');
  if (fs.existsSync(extPath)) {
    const extData = JSON.parse(fs.readFileSync(extPath, 'utf8'));
    const catalog = extData.providerCatalog || {};
    for (const cKey of Object.keys(catalog)) {
      // cKey is already the catalog key (e.g. 'openrouter-free', 'nvidia-nim')
      // Map it back to both the raw provider name and common prefix aliases
      const short = cKey.replace(/-free$/, '').replace(/-nim$/, '').replace(/-cloud$/, '');
      for (const alias of [cKey, short]) {
        if (!CANONICAL_CATALOG_MAP[alias]) CANONICAL_CATALOG_MAP[alias] = [];
        if (!CANONICAL_CATALOG_MAP[alias].includes(cKey)) CANONICAL_CATALOG_MAP[alias].push(cKey);
      }
    }
  }
} catch { /* catalog enrichment is optional */ }

// ---------------------------------------------------------------------------
// STANDARD_PROVIDER_PREFIXES — built from active SQLite connections at runtime.
// Maps every known provider name/alias → its routing prefix.
// Falls back to splitting on '-' for unknown providers.
// ---------------------------------------------------------------------------
const STANDARD_PROVIDER_PREFIXES = {};
{
  const conns = (storage.readActiveProviderConnections ? storage.readActiveProviderConnections() : []);
  for (const conn of conns) {
    const prov = String(conn.provider || '').toLowerCase();
    const prefix = conn.prefix || prov.split('-')[0];
    STANDARD_PROVIDER_PREFIXES[prov] = prefix;
    if (conn.prefix) STANDARD_PROVIDER_PREFIXES[conn.prefix] = prefix;
  }
  // Bespoke overrides from registry (e.g. kilo → kc, openrouter → openrouter)
  for (const b of BESPOKE_PROVIDERS) {
    if (b.connection) STANDARD_PROVIDER_PREFIXES[b.connection] = b.key;
    STANDARD_PROVIDER_PREFIXES[b.key] = b.key;
  }
}

// ---------------------------------------------------------------------------
// PROVIDER_DISPLAY_NAMES — built from active SQLite connections at runtime.
// Falls back to titlecasing the provider name.
// ---------------------------------------------------------------------------
const PROVIDER_DISPLAY_NAMES = {};
{
  const conns = (storage.readActiveProviderConnections ? storage.readActiveProviderConnections() : []);
  for (const conn of conns) {
    const prov = String(conn.provider || '').toLowerCase();
    const label = conn.name && !conn.name.includes('@') ? conn.name : prov.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    PROVIDER_DISPLAY_NAMES[prov] = label;
    if (conn.prefix) PROVIDER_DISPLAY_NAMES[conn.prefix] = label;
  }
}

function getProviderLabel(providerName, prefix, connectionName) {
  const p = String(providerName || '').toLowerCase();
  if (PROVIDER_DISPLAY_NAMES[p]) return PROVIDER_DISPLAY_NAMES[p];
  if (connectionName && connectionName.trim() && !connectionName.includes('@')) return connectionName.trim();
  if (prefix && PROVIDER_DISPLAY_NAMES[String(prefix).toLowerCase()]) return PROVIDER_DISPLAY_NAMES[String(prefix).toLowerCase()];
  const raw = p.replace(/-/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

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

/**
 * Format full routing ID for 9router requests: `${prefix}/${modelId}`.
 * Preserves upstream publisher namespaces (e.g. `nvidia/nemotron-...` -> `nvidia/nvidia/nemotron-...`).
 */
function formatRoutingFullId(prefix, modelId) {
  const p = String(prefix || '').toLowerCase();
  let mId = String(modelId || '').trim();
  if (!mId) return '';
  if (p === 'nvidia') {
    if (mId.startsWith('nvidia/nvidia/')) return mId;
    if (mId.startsWith('nvidia/')) return `nvidia/${mId}`;
    if (mId.startsWith('nemotron')) return `nvidia/nvidia/${mId}`;
    return `nvidia/${mId}`;
  }
  if (mId.startsWith(`${p}/`)) return mId;
  return `${p}/${mId}`;
}

// ----------------------------------------------------------------------------
// Internal Credential Resolution
// ----------------------------------------------------------------------------

function getProviderCredentials(recordOrKey) {
  if (!recordOrKey) return { apiKey: null, baseUrl: '', prefix: '' };
  let record = typeof recordOrKey === 'string' ? PROVIDER_BY_KEY[recordOrKey] : recordOrKey;
  if (!record) {
    record = { prefixes: [String(recordOrKey)], connection: String(recordOrKey) };
  }

  // If passed an active connection object directly from storage
  if (record.data || record.provider) {
    const data = record.data || {};
    const prov = String(record.provider || '').toLowerCase();
    const prefix = record.prefix || data.providerSpecificData?.prefix || STANDARD_PROVIDER_PREFIXES[prov] || prov.split('-')[0];
    const baseUrl = data.providerSpecificData?.baseUrl || data.providerSpecificData?.inferenceBaseUrl || data.baseUrl || '';
    const apiKey = data.apiKey || data.accessToken || data.token || null;
    return { apiKey, prefix, baseUrl };
  }

  if (record.credentialKind === 'scan') return scanConnectionCredentials(record);
  if (record.credentialKind === 'kilo') return kiloConnectionCredentials(record);
  if (record.credentialKind === 'bai') return baiConnectionCredentials(record);
  if (record.credentialKind === 'cloudflare') return cloudflareConnectionCredentials();

  const connKey = record.connection || record.key || (Array.isArray(record.prefixes) ? record.prefixes[0] : null);
  const parsed = connKey ? storage.readProviderConnection(connKey) : null;
  const defPrefix = (Array.isArray(record.prefixes) && record.prefixes[0]) || record.prefix || record.key || '';
  return {
    apiKey: parsed?.apiKey || parsed?.accessToken || parsed?.token || null,
    prefix: parsed?.providerSpecificData?.prefix || defPrefix,
    baseUrl: (record.readBaseUrlFromConnection && parsed?.providerSpecificData?.baseUrl) || parsed?.providerSpecificData?.inferenceBaseUrl || parsed?.providerSpecificData?.baseUrl || parsed?.baseUrl || record.baseUrl || ''
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
    console.log('[-] Fetching free models from Kilo.ai Gateway (/api/v1/models)...');
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch(`${gatewayUrl}/models`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = json.data || json.models || [];
    for (const m of models) {
      const id = m.id || '';
      if (!id) continue;
      if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;
      const lowerId = id.toLowerCase();
      // Kilo free models strictly require :free or -free suffix
      const isFree = lowerId.endsWith(':free') || lowerId.endsWith('-free');
      if (isFree) {
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

async function fetchOpenRouterFreeModels(apiKey, baseUrl = 'https://openrouter.ai/api/v1', prefix = 'openrouter') {
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
          fullId: formatRoutingFullId(prefix, id),
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

async function fetchPoolsideFreeModels(apiKey, baseUrl = 'https://inference.poolside.ai/v1', prefix = 'poolside') {
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
          fullId: formatRoutingFullId(prefix, id),
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

async function fetchGeminiFreeModels(apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta', prefix = 'gemini') {
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
      if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;
      if (id) {
        freeModels.push({
          id,
          fullId: formatRoutingFullId(prefix, id),
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

async function fetchOllamaFreeModels(apiKey, baseUrl = 'https://api.ollama.com/v1', prefix = 'ollama') {
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
      if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;
      freeModels.push({
        id,
        fullId: formatRoutingFullId(prefix, id),
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

async function fetchAirforceFreeModels(apiKey, baseUrl = 'https://api.airforce/v1', prefix = 'api-airforce') {
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
      if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;
      freeModels.push({
        id,
        fullId: formatRoutingFullId(prefix, id),
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

async function fetchBazaarlinkFreeModels(apiKey, baseUrl = 'https://bazaarlink.ai/api/v1', prefix = 'bazaarlink') {
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
          fullId: formatRoutingFullId(prefix, id),
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

async function fetchOpenAiCompatibleFreeModels({ label, apiKey, baseUrl, prefix, skipPatterns = [], freePattern = null, requireApiKey = false }) {
  const freeModels = [];
  if (requireApiKey && !apiKey) {
    return freeModels;
  }
  if (!baseUrl) {
    return freeModels;
  }

  try {
    console.log(`[-] Fetching free models from ${label} (/models)...`);
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
    const candidateUrls = [
      cleanBaseUrl.endsWith('/models') ? cleanBaseUrl : `${cleanBaseUrl}/models`,
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
      } catch { }
    }

    if (!json) {
      console.warn(`[!] ${label} fetch notice: Endpoint /models not responding on ${cleanBaseUrl}`);
      return freeModels;
    }

    const models = Array.isArray(json) ? json : (json.data || json.models || []);
    const seenIds = new Set();

    for (const m of models) {
      const id = m.id || m.name || m.model || '';
      if (!id || seenIds.has(id)) continue;
      const name = m.name || m.summary || id;
      const lowerId = id.toLowerCase();

      if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;
      if (skipPatterns && skipPatterns.some(pat => lowerId === pat || lowerId.includes(pat))) continue;

      const pricing = m.pricing || {};
      const promptCost = Number(pricing.prompt ?? -1);
      const completionCost = Number(pricing.completion ?? -1);
      const isZeroCost = (promptCost === 0 && completionCost === 0);
      const hasFreeSuffix = lowerId.endsWith(':free') || lowerId.endsWith('-free');
      const isFreeFlag = m.is_free === true || m.isFree === true;

      let isFree = hasFreeSuffix || isZeroCost || isFreeFlag;

      if (freePattern) {
        const patterns = Array.isArray(freePattern) ? freePattern : [freePattern];
        const matchesAny = patterns.some(pat => {
          const p = String(pat).toLowerCase();
          return p.startsWith('-') || p.startsWith(':') ? lowerId.endsWith(p) || lowerId.includes(p) : lowerId.includes(p);
        });
        if (matchesAny) isFree = true;
      }

      // If provider requires free suffix / free pricing (e.g. openrouter, nous, aihubmix), drop paid models
      if (isPaidModel(prefix, id, pricing) && !isFree) continue;

      seenIds.add(id);

      freeModels.push({
        id,
        fullId: formatRoutingFullId(prefix, id),
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

const fetchNousFreeModels = (apiKey, baseUrl, prefix) => fetchOpenAiCompatibleFreeModels({
  label: 'Nous Portal',
  apiKey,
  baseUrl: baseUrl || 'https://inference-api.nousresearch.com/v1',
  prefix: prefix || 'nous',
  requireApiKey: false
});

async function fetchCloudflareFreeModels(creds, prefix = 'cloudflare-ai') {
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
        if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;

        const props = Object.fromEntries((Array.isArray(m.properties) ? m.properties : [])
          .map(prop => [prop.property_id, prop.value]));

        const hasPrice = Array.isArray(props.price) && props.price.length > 0;
        const needsPaid = String(props.require_workers_paid) === 'true';
        if (hasPrice || needsPaid) continue;

        freeModels.push({
          id,
          fullId: formatRoutingFullId(prefix, id),
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

// ----------------------------------------------------------------------------
// Free-Only Provider Guard
// ----------------------------------------------------------------------------

// Loaded from provider-registry.json freeOnly array.
// To add more: edit the "freeOnly" array in provider-registry.json.
const REQUIRE_FREE_SUFFIX_PROVIDERS = new Set(_reg.freeOnly || []);

function isFreeOnlyProvider(providerOrPrefix) {
  if (!providerOrPrefix) return false;
  const p = String(providerOrPrefix).toLowerCase();
  if (REQUIRE_FREE_SUFFIX_PROVIDERS.has(p)) return true;
  if (p.startsWith('openai-compatible') || p.startsWith('custom-')) return true;
  return false;
}

function isPaidModel(providerOrPrefix, modelId, pricingObj = null) {
  const lId = String(modelId || '').toLowerCase();
  if (lId.endsWith(':free') || lId.endsWith('-free')) return false;
  if (lId === 'grok-4.20-fast') return false;
  if (pricingObj && Number(pricingObj.prompt) === 0 && Number(pricingObj.completion) === 0) return false;
  if (pricingObj && (Number(pricingObj.prompt) > 0 || Number(pricingObj.completion) > 0)) return true;

  if (isFreeOnlyProvider(providerOrPrefix)) return true;
  return false;
}

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
    const models = await fetchOpenRouterFreeModels(creds.apiKey, creds.baseUrl, creds.prefix || 'openrouter');
    return { prefix: creds.prefix || 'openrouter', models };
  },

  poolside: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchPoolsideFreeModels(creds.apiKey, creds.baseUrl, creds.prefix || 'poolside');
    return { prefix: creds.prefix || 'poolside', models };
  },

  gemini: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchGeminiFreeModels(creds.apiKey, creds.baseUrl, creds.prefix || 'gemini');
    return { prefix: creds.prefix || 'gemini', models };
  },

  ollama: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchOllamaFreeModels(creds.apiKey, creds.baseUrl, creds.prefix || 'ollama');
    return { prefix: creds.prefix || 'ollama', models };
  },

  airforce: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchAirforceFreeModels(creds.apiKey, creds.baseUrl, creds.prefix || 'api-airforce');
    return { prefix: creds.prefix || 'api-airforce', models };
  },

  bazaarlink: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchBazaarlinkFreeModels(creds.apiKey, creds.baseUrl, creds.prefix || 'bazaarlink');
    return { prefix: creds.prefix || 'bazaarlink', models };
  },

  bai: async record => {
    const creds = getProviderCredentials(record);
    const models = await fetchOpenAiCompatibleFreeModels({
      label: 'B.ai', apiKey: creds.apiKey, baseUrl: creds.baseUrl, prefix: creds.prefix
    });
    return { prefix: creds.prefix || 'b.ai', models };
  },

  cloudflare: async () => {
    const creds = cloudflareConnectionCredentials();
    const models = await fetchCloudflareFreeModels(creds, creds.prefix || 'cloudflare-ai');
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

    // Automatically mark all custom / openai-compatible gateways as free-only providers
    if (prov.startsWith('openai-compatible') || prov.includes('custom') || (conn.authType === 'apikey' && (conn.data?.providerSpecificData?.baseUrl || conn.providerSpecificData?.baseUrl))) {
      REQUIRE_FREE_SUFFIX_PROVIDERS.add(prov);
      REQUIRE_FREE_SUFFIX_PROVIDERS.add(prefix);
    }
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
    } catch { }
  }
  // Support built-in OpenCode (oc) models if present in 9router models list
  if (modelsList.some(m => String(m.id || '').startsWith('oc/')) && !activeByPrefix.has('oc')) {
    const ocConn = { provider: 'opencode', prefix: 'oc', name: 'OpenCode' };
    activeConns.push(ocConn);
    activeByPrefix.set('oc', ocConn);
    activeByProvider.set('opencode', ocConn);
  }

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

  // 1. Generic upstream discovery for ANY active connection with baseUrl and credentials
  for (const conn of activeConns) {
    const prov = String(conn.provider || '').toLowerCase();
    const prefix = conn.prefix || STANDARD_PROVIDER_PREFIXES[prov] || prov;
    const targetKey = prefix;
    const data = conn.data || {};
    const spec = data.providerSpecificData || {};
    const creds = getProviderCredentials(conn);
    const baseUrl = spec.baseUrl || spec.inferenceBaseUrl || data.baseUrl || creds.baseUrl || '';
    const apiKey = creds.apiKey || data.apiKey || data.accessToken || data.token;

    if (baseUrl && (apiKey || creds.requireApiKey === false)) {
      try {
        const liveModels = await fetchOpenAiCompatibleFreeModels({
          label: conn.name || getProviderLabel(prov, prefix, conn.name),
          apiKey,
          baseUrl,
          prefix: targetKey,
          freePattern: [':free', '-free'],
          requireApiKey: false
        });
        for (const lm of liveModels) {
          const fId = (lm.fullId || formatRoutingFullId(targetKey, lm.id)).toLowerCase();
          if (!seenFullIds.has(fId)) {
            seenFullIds.add(fId);
            results[targetKey].models.push({
              ...lm,
              fullId: lm.fullId || formatRoutingFullId(targetKey, lm.id),
              source: `${targetKey}-upstream-live`
            });
          }
        }
      } catch (err) {
        // Soft fail if upstream does not respond
      }
    }
  }

  for (const m of modelsList) {
    const id = String(m.id || '');
    if (!id || seenFullIds.has(id)) continue;
    if (m.owned_by === 'combo' || id === 'free' || id.startsWith('my9model-') || (!id.includes('/') && id.endsWith('-free'))) {
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
    if (storage.isModelExcluded ? storage.isModelExcluded(id) : false) continue;

    // Guard against paid models from providers that require :free suffix (e.g. openrouter, aihubmix, inferera)
    if (isPaidModel(conn.provider, id, m.pricing) || isPaidModel(prefix, id, m.pricing)) {
      seenFullIds.add(id);
      continue;
    }

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
      fullId: formatRoutingFullId(targetKey, modelId),
      name: m.name || modelId,
      source: `${targetKey}-9router`,
      contextLength,
      toolsUnsupported,
      reasoning
    });
  }

  // Also harvest candidate models from 9router's disabledModels and customModels lists
  const disabledMap = storage.read9routerDisabledModels ? storage.read9routerDisabledModels() : {};
  const customList = storage.read9routerCustomModels ? storage.read9routerCustomModels() : [];

  for (const conn of activeConns) {
    const prov = String(conn.provider || '').toLowerCase();
    const prefix = conn.prefix || STANDARD_PROVIDER_PREFIXES[prov] || prov;
    const targetKey = prefix;
    if (!results[targetKey]) continue;

    // 1. Harvest disabled models for this provider so they can be candidate tested & re-enabled
    const disabledForProv = [
      ...(disabledMap[prov] || []),
      ...(disabledMap[prefix] || []),
      ...(disabledMap[targetKey] || [])
    ];
    for (const dId of disabledForProv) {
      if (!dId) continue;
      let cleanDId = String(dId);
      if (cleanDId.toLowerCase().startsWith(`${targetKey}/`)) {
        cleanDId = cleanDId.slice(targetKey.length + 1);
      }
      if (isPaidModel(prov, cleanDId) || isPaidModel(targetKey, cleanDId)) continue;
      if (storage.isModelExcluded && (storage.isModelExcluded(cleanDId) || storage.isModelExcluded(`${targetKey}/${cleanDId}`))) continue;
      const fullId = formatRoutingFullId(targetKey, cleanDId);
      if (!seenFullIds.has(fullId.toLowerCase())) {
        seenFullIds.add(fullId.toLowerCase());
        results[targetKey].models.push({
          id: cleanDId,
          fullId,
          name: cleanDId,
          source: `${targetKey}-9router-disabled-harvest`,
          contextLength: 131072
        });
      }
    }

    // 2. Harvest customModels for this provider
    for (const cm of customList) {
      const cAlias = String(cm.providerAlias || '').toLowerCase();
      if (cAlias === prov || cAlias === prefix || cAlias === targetKey) {
        let cleanCId = String(cm.id || '');
        if (cleanCId.toLowerCase().startsWith(`${targetKey}/`)) {
          cleanCId = cleanCId.slice(targetKey.length + 1);
        }
        if (!cleanCId) continue;
        if (isPaidModel(prov, cleanCId) || isPaidModel(targetKey, cleanCId)) continue;
        if (storage.isModelExcluded && (storage.isModelExcluded(cleanCId) || storage.isModelExcluded(`${targetKey}/${cleanCId}`))) continue;
        const fullId = formatRoutingFullId(targetKey, cleanCId);
        if (!seenFullIds.has(fullId.toLowerCase())) {
          seenFullIds.add(fullId.toLowerCase());
          results[targetKey].models.push({
            id: cleanCId,
            fullId,
            name: cm.name || cleanCId,
            source: `${targetKey}-9router-custom-models`,
            contextLength: 131072
          });
        }
      }
    }
  }

  // Enrich all active provider records with external free model catalogs if available
  for (const [targetKey, providerRecord] of Object.entries(results)) {
    enrichProviderCandidatesFromExternalCatalog(targetKey, providerRecord.provider, providerRecord.models, providerRecord.prefix);
  }

  return results;
}

/**
 * Enrich candidate models for a provider using the harvested external catalog (external-models.json).
 */
function enrichProviderCandidatesFromExternalCatalog(targetKey, providerName, existingModels, prefix) {
  const externalModelsPath = path.join(__dirname, 'external-models.json');
  if (!fs.existsSync(externalModelsPath)) return;
  try {
    const extData = JSON.parse(fs.readFileSync(externalModelsPath, 'utf8'));
    const catalog = extData.providerCatalog || {};
    const modelsMeta = extData.models || [];

    // Load dead-models.json to avoid seeding confirmed dead models
    let deadStore = null;
    const deadModelsPath = path.join(__dirname, 'dead-models.json');
    if (fs.existsSync(deadModelsPath)) {
      try {
        deadStore = JSON.parse(fs.readFileSync(deadModelsPath, 'utf8'));
      } catch { }
    }

    const provLower = String(providerName || '').toLowerCase();
    const prefLower = String(prefix || '').toLowerCase();
    const targetLower = String(targetKey || '').toLowerCase();
    const catalogKeysRaw = CANONICAL_CATALOG_MAP[targetLower] || CANONICAL_CATALOG_MAP[prefLower] || CANONICAL_CATALOG_MAP[provLower];
    if (!catalogKeysRaw) return;
    const catalogKeys = Array.isArray(catalogKeysRaw) ? catalogKeysRaw : [catalogKeysRaw];

    const candidatesToAdd = new Set();
    for (const cKey of catalogKeys) {
      const catalogModels = catalog[cKey] || [];
      for (const mId of catalogModels) {
        candidatesToAdd.add(mId);
      }
    }

    for (const em of modelsMeta) {
      const emProv = String(em.provider || '').toLowerCase();
      if (catalogKeys.includes(emProv)) {
        candidatesToAdd.add(em.id);
      }
    }

    // Rank candidates by coding capability & metadata score descending before capping
    const candidateList = Array.from(candidatesToAdd);
    const scoreCandidate = id => {
      const lower = String(id || '').toLowerCase();
      let score = 50;
      if (lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus')) score += 50;
      else if (lower.includes('gemini') || lower.includes('gpt-4') || lower.includes('o1') || lower.includes('o3') || lower.includes('r1')) score += 40;
      else if (lower.includes('qwen') || lower.includes('deepseek') || lower.includes('codestral') || lower.includes('mistral') || lower.includes('glm') || lower.includes('kimi')) score += 30;
      else if (lower.includes('nemotron') || lower.includes('gemma') || lower.includes('flint') || lower.includes('beam')) score += 25;
      else if (lower.includes('coder') || lower.includes('code') || lower.includes('instruct') || lower.includes('preview')) score += 15;
      const meta = modelsMeta.find(m => m.id === id) || {};
      if (typeof meta.score === 'number') score += meta.score;
      return score;
    };
    candidateList.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

    const MAX_EXTERNAL_CANDIDATES = 30;
    const cappedCandidates = candidateList.slice(0, MAX_EXTERNAL_CANDIDATES);

    const seenIds = new Set(existingModels.map(m => m.id.toLowerCase()));
    const seenFullIds = new Set(existingModels.map(m => (m.fullId || '').toLowerCase()));
    for (const extId of cappedCandidates) {
      // If the target provider requires free suffix (openrouter requires :free; aihubmix allows :free or -free)
      const tKey = targetKey.toLowerCase();
      const prefKey = prefix.toLowerCase();
      const provKey = String(providerName || '').toLowerCase();
      const isFreeOnly = isFreeOnlyProvider(tKey) || isFreeOnlyProvider(prefKey) || isFreeOnlyProvider(provKey);
      if (isFreeOnly) {
        const extLower = extId.toLowerCase();
        const isOpenRouter = tKey.includes('openrouter') || prefKey.includes('openrouter') || provKey.includes('openrouter');
        const isValidFree = isOpenRouter ? extLower.endsWith(':free') : (extLower.endsWith(':free') || extLower.endsWith('-free') || extLower === 'grok-4.20-fast');
        if (!isValidFree) {
          continue;
        }
      }
      const isFreeOnlyProviderFlag = isFreeOnly;
      let cleanId;
      if (isFreeOnlyProviderFlag) {
        cleanId = (extId.endsWith(':free') || extId.endsWith('-free') || extId === 'grok-4.20-fast') ? extId : (extId + ':free');
      } else {
        cleanId = extId.replace(/:free$/, '');
      }
      // Generically preserve org namespace: only strip target provider prefix itself if present at head
      const pHeads = [prefix, targetKey, providerName].filter(Boolean).map(p => String(p).toLowerCase());
      for (const ph of pHeads) {
        if (cleanId.toLowerCase().startsWith(`${ph}/`)) {
          cleanId = cleanId.slice(ph.length + 1);
        }
      }
      if (storage.isModelExcluded && (storage.isModelExcluded(cleanId) || storage.isModelExcluded(extId))) {
        continue;
      }
      const fullId = formatRoutingFullId(prefix, cleanId);
      if (deadStore && deadStore.models && deadStore.models[fullId]?.confirmedDead) {
        continue;
      }
      if (seenIds.has(cleanId.toLowerCase()) || seenFullIds.has(fullId.toLowerCase())) {
        continue;
      }
      seenIds.add(cleanId.toLowerCase());
      seenFullIds.add(fullId.toLowerCase());

      const meta = modelsMeta.find(m => m.id === extId || m.id === cleanId) || {};
      existingModels.push({
        id: cleanId,
        fullId,
        name: meta.name || cleanId,
        source: `${prefix}-external-catalog`,
        contextLength: meta.contextLength || 131072,
        tier: meta.tier || 'A',
        score: meta.score
      });
    }
  } catch (err) {
    console.warn(`[!] External catalog enrichment warning for ${providerName}: ${err.message}`);
  }
}

/**
 * Deep discovery interface: discover free model candidates for a single provider.
 */
async function discoverProvider(recordOrKey) {
  const record = typeof recordOrKey === 'string' ? PROVIDER_BY_KEY[recordOrKey] : recordOrKey;
  if (!record) throw new Error(`Provider not found: ${recordOrKey}`);
  const impl = PROVIDER_DISCOVERY_MAP[record.kind] || PROVIDER_DISCOVERY_MAP['openai-compatible'];
  return impl(record);
}

/**
 * Deep discovery interface: discover free model candidates for all registered providers in parallel.
 * Automatically combines active 9router deployment providers with built-in adapters and dynamic connections.
 */
async function discoverAllProviders(options = {}) {
  const excludedProviders = (options.excludedProviders || []).map(p => String(p).toLowerCase());

  // Active 9router connections must NEVER be silenced by default exclusions
  const activeConns = storage.readActiveProviderConnections ? storage.readActiveProviderConnections() : [];
  const activeProvidersSet = new Set(activeConns.map(c => String(c.provider || '').toLowerCase()));
  const activePrefixesSet = new Set(activeConns.map(c => String(c.prefix || '').toLowerCase()));
  activePrefixesSet.add('oc');
  activeProvidersSet.add('opencode');

  const isExcluded = rec => {
    const prefixes = (rec.prefixes || [rec.prefix] || []).map(p => String(p).toLowerCase());
    const prov = String(rec.provider || rec.key || '').toLowerCase();
    if (activeProvidersSet.has(prov) || prefixes.some(p => activePrefixesSet.has(p))) {
      return false;
    }
    return prefixes.some(p => excludedProviders.includes(p)) || excludedProviders.includes(prov);
  };

  const results = {};

  // 1. Discover Active Providers directly from 9router deployment
  try {
    const nineRouterActive = await discover9routerActiveProviders(options);
    for (const [key, p] of Object.entries(nineRouterActive)) {
      if (isExcluded(p)) {
        results[key] = { ...p, models: [], excluded: true };
      } else {
        results[key] = p;
      }
    }
  } catch (err) {
    console.warn(`[!] 9router active provider discovery notice: ${err.message}`);
  }

  // 2. Discover Built-in Providers (ONLY if provider is active in 9router, or if there are no active connections at all)
  await Promise.all(PROVIDERS.map(async rec => {
    // Only run discovery for providers configured and active on 9router
    const prefixes = (rec.prefixes || [rec.prefix] || []).map(p => String(p).toLowerCase());
    const prov = String(rec.provider || rec.key || '').toLowerCase();
    const isProviderActiveIn9router = activeProvidersSet.has(prov) || prefixes.some(p => activePrefixesSet.has(p));
    if (activeConns.length > 0 && !isProviderActiveIn9router) {
      return; // Skip providers not active on 9router
    }

    if (isExcluded(rec)) {
      if (!results[rec.key]) {
        results[rec.key] = { prefix: rec.prefixes[0], models: [], excluded: true, label: rec.label, combo: rec.combo };
      }
      return;
    }

    try {
      const res = await discoverProvider(rec);
      const prefix = rec.prefixes[0];
      const liveModels = (res && res.models) ? res.models : [];
      const targetKey = results[rec.key] ? rec.key : (results[prefix] ? prefix : rec.key);
      const existingModels = results[targetKey]?.models || [];

      const seenFullIds = new Set();
      const mergedModels = [];

      // 1. Upstream live models first
      for (const m of liveModels) {
        const fId = (m.fullId || formatRoutingFullId(prefix, m.id)).toLowerCase();
        if (!seenFullIds.has(fId)) {
          seenFullIds.add(fId);
          mergedModels.push({
            ...m,
            fullId: m.fullId || formatRoutingFullId(prefix, m.id),
            source: `${prefix}-upstream-live`
          });
        }
      }

      // 2. Existing 9router/external models
      for (const m of existingModels) {
        const fId = (m.fullId || formatRoutingFullId(prefix, m.id)).toLowerCase();
        // Drop single-prefixed nemotron if nvidia provider
        if (prefix === 'nvidia' && fId.startsWith('nvidia/nemotron-') && !fId.startsWith('nvidia/nvidia/')) {
          continue;
        }
        if (!seenFullIds.has(fId)) {
          seenFullIds.add(fId);
          mergedModels.push(m);
        }
      }

      enrichProviderCandidatesFromExternalCatalog(rec.key, rec.usageName || rec.key, mergedModels, prefix);

      if (results[targetKey]) {
        results[targetKey].models = mergedModels;
      } else {
        results[targetKey] = { ...res, prefix, models: mergedModels, label: rec.label, combo: rec.combo };
      }
    } catch (err) {
      console.warn(`[!] Failed to discover ${rec.label}: ${err.message}`);
      const prefix = rec.prefixes[0];
      const targetKey = results[rec.key] ? rec.key : (results[prefix] ? prefix : rec.key);
      if (!results[targetKey]) {
        const fallbackModels = [];
        enrichProviderCandidatesFromExternalCatalog(rec.key, rec.usageName || rec.key, fallbackModels, prefix);
        results[targetKey] = { prefix, models: fallbackModels, label: rec.label, combo: rec.combo };
      }
    }
  }));

  // 3. Discover Dynamic Providers from 9router Active Connections
  try {
    const dynamicProviders = storage.getDynamicProviders ? storage.getDynamicProviders() : [];
    await Promise.all(dynamicProviders.map(async dp => {
      const targetKey = results[dp.key] ? dp.key : (results[dp.prefix] ? dp.prefix : dp.key);

      if (!dp.enabled || isExcluded(dp) || excludedProviders.includes(dp.provider.toLowerCase())) {
        if (!results[targetKey]) {
          results[targetKey] = { prefix: dp.prefix, models: [], excluded: true, label: dp.label, combo: dp.combo, isDynamic: true };
        }
        return;
      }

      if (!dp.baseUrl) {
        if (!results[targetKey]) {
          results[targetKey] = { prefix: dp.prefix, models: [], label: dp.label, combo: dp.combo, isDynamic: true };
        }
        return;
      }

      try {
        const liveModels = await fetchOpenAiCompatibleFreeModels({
          label: dp.label,
          apiKey: dp.apiKey,
          baseUrl: dp.baseUrl,
          prefix: dp.prefix,
          skipPatterns: dp.skipPatterns,
          freePattern: dp.freePattern,
          requireApiKey: false
        });

        const existingModels = results[targetKey]?.models || [];
        const seenFull = new Set();
        const merged = [];

        for (const m of liveModels) {
          const fId = (m.fullId || formatRoutingFullId(dp.prefix, m.id)).toLowerCase();
          if (!seenFull.has(fId)) {
            seenFull.add(fId);
            merged.push({
              ...m,
              fullId: m.fullId || formatRoutingFullId(dp.prefix, m.id),
              source: `${dp.prefix}-upstream-live`
            });
          }
        }

        for (const m of existingModels) {
          const fId = (m.fullId || formatRoutingFullId(dp.prefix, m.id)).toLowerCase();
          if (!seenFull.has(fId)) {
            seenFull.add(fId);
            merged.push(m);
          }
        }

        enrichProviderCandidatesFromExternalCatalog(dp.prefix, dp.provider, merged, dp.prefix);

        if (results[targetKey]) {
          results[targetKey].models = merged;
        } else {
          results[targetKey] = { prefix: dp.prefix, models: merged, label: dp.label, combo: dp.combo, isDynamic: true };
        }
      } catch (err) {
        console.warn(`[!] Failed to discover dynamic provider ${dp.label}: ${err.message}`);
        if (!results[targetKey]) {
          results[targetKey] = { prefix: dp.prefix, models: [], label: dp.label, combo: dp.combo, isDynamic: true };
        }
      }
    }));
  } catch (err) {
    console.warn(`[!] Dynamic provider discovery notice: ${err.message}`);
  }

  return results;
}

module.exports = {
  CANONICAL_CATALOG_MAP,
  PROVIDERS,
  PROVIDER_BY_KEY,
  STANDARD_PROVIDER_PREFIXES,
  PROVIDER_DISPLAY_NAMES,
  getProviderLabel,
  providerByPrefix,
  getProviderCredentials,
  discoverProvider,
  discover9routerActiveProviders,
  discoverAllProviders,
  enrichProviderCandidatesFromExternalCatalog,
  formatRoutingFullId,
  REQUIRE_FREE_SUFFIX_PROVIDERS,
  isFreeOnlyProvider,
  isPaidModel,
  fetchOpenAiCompatibleFreeModels,
  fetchNousFreeModels
};
