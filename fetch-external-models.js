#!/usr/bin/env node

/**
 * 9router Auto-Free — External Free Models Harvester
 *
 * Pulls and parses verified free coding models, SWE-bench Verified rankings,
 * quotas, and model lifecycles from:
 * 1. vava-nessa/free-coding-models (sources.js)
 * 2. mvalentsev/awesome-free-ai-coding (index.json)
 * 3. peter123023/awesome-free-llm-api (README.en.md)
 *
 * Implements exponential backoff with jitter and offline fallback.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const SOURCES_JS_URL = 'https://raw.githubusercontent.com/vava-nessa/free-coding-models/main/sources.js';
const INDEX_JSON_URL = 'https://raw.githubusercontent.com/mvalentsev/awesome-free-ai-coding/main/index.json';
const README_EN_URL = 'https://raw.githubusercontent.com/peter123023/awesome-free-llm-api/main/README.en.md';
const MODELS_DEV_URL = 'https://models.dev/api.json';
const KILO_GATEWAY_URL = 'https://ai-gateway.kilo.ai/api/v1/models';
const EXTERNAL_MODELS_PATH = path.join(__dirname, 'external-models.json');

const DEAD_MODELS_PATH = path.join(__dirname, 'dead-models.json');

let providersHelper = null;
try {
  providersHelper = require('./providers.js');
} catch {}

const RETRY_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Fetch a resource with exponential backoff and jitter.
 */
async function fetchWithBackoff(url, {
  retries = 3,
  baseDelayMs = 1000,
  timeoutMs = 15000,
  fetchImpl = null
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(timeoutMs)
        : undefined;

      const res = await doFetch(url, { signal });
      if (res.ok) {
        return await res.text();
      }

      if (RETRY_HTTP_STATUSES.has(res.status) && attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw new Error(`HTTP ${res.status}: ${res.statusText || 'Fetch failed'}`);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${retries} retries`);
}

/**
 * Parse human context length strings (e.g., "128k", "1M", "32k") to integer tokens.
 */
function parseContextLength(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw || typeof raw !== 'string') return 131072;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.endsWith('m')) {
    const val = parseFloat(cleaned);
    return isNaN(val) ? 1048576 : Math.round(val * 1048576);
  }
  if (cleaned.endsWith('k')) {
    const val = parseFloat(cleaned);
    return isNaN(val) ? 131072 : Math.round(val * 1024);
  }
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 131072 : parsed;
}

function isDeprecatedDateOrStatus(val) {
  if (!val) return false;
  if (val === 'deprecated' || val === 'shutdown') return true;
  const parsed = new Date(val).getTime();
  if (!isNaN(parsed)) {
    return parsed <= Date.now();
  }
  return false;
}

/**
 * Parse sources.js content from vava-nessa/free-coding-models.
 */
async function parseSourcesContent(content) {
  const models = [];
  const providerCatalog = {};
  const deprecatedRecords = [];

  const tmpFile = path.join(os.tmpdir(), `sources_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    const mod = await import(pathToFileURL(tmpFile).href);

    const sources = mod.sources || {};
    for (const [providerKey, sourceData] of Object.entries(sources)) {
      if (!sourceData || !Array.isArray(sourceData.models)) continue;
      if (!providerCatalog[providerKey]) providerCatalog[providerKey] = [];

      for (const m of sourceData.models) {
        if (!Array.isArray(m)) continue;
        const [modelId, label, tier, sweScore, ctx, addedDate, deprecatedAfter] = m;
        if (isDeprecatedDateOrStatus(deprecatedAfter)) {
          deprecatedRecords.push({
            modelId,
            name: label || modelId,
            provider: providerKey,
            reason: `Deprecated after ${deprecatedAfter} in sources.js`
          });
          continue;
        }
        const modelObj = {
          id: modelId,
          name: label || modelId,
          tier: tier || 'A',
          score: typeof sweScore === 'number' ? sweScore : parseFloat(sweScore) || 50,
          contextLength: parseContextLength(ctx),
          provider: providerKey,
          addedDate: addedDate || null,
          deprecatedAfter: null
        };
        models.push(modelObj);
        providerCatalog[providerKey].push(modelId);
      }
    }

    // Also parse flat MODELS if present and providerCatalog didn't catch everything
    if (Array.isArray(mod.MODELS)) {
      for (const m of mod.MODELS) {
        if (!Array.isArray(m)) continue;
        const [modelId, label, tier, sweScore, ctx, providerKey, addedDate, deprecatedAfter] = m;
        if (isDeprecatedDateOrStatus(deprecatedAfter)) {
          deprecatedRecords.push({
            modelId,
            name: label || modelId,
            provider: providerKey || 'general',
            reason: `Deprecated after ${deprecatedAfter} in sources.js`
          });
          continue;
        }
        if (!models.some(existing => existing.id === modelId && existing.provider === providerKey)) {
          const modelObj = {
            id: modelId,
            name: label || modelId,
            tier: tier || 'A',
            score: typeof sweScore === 'number' ? sweScore : parseFloat(sweScore) || 50,
            contextLength: parseContextLength(ctx),
            provider: providerKey || 'general',
            addedDate: addedDate || null,
            deprecatedAfter: null
          };
          models.push(modelObj);
          if (providerKey) {
            if (!providerCatalog[providerKey]) providerCatalog[providerKey] = [];
            if (!providerCatalog[providerKey].includes(modelId)) providerCatalog[providerKey].push(modelId);
          }
        }
      }
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }

  return { models, providerCatalog, deprecatedRecords };
}

/**
 * Parse index.json from mvalentsev/awesome-free-ai-coding.
 */
function parseIndexJsonContent(content) {
  const data = typeof content === 'string' ? JSON.parse(content) : content;
  const entries = data.entries || [];
  const quotas = {};
  const providerCatalog = {};

  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    const key = String(entry.id).toLowerCase();
    quotas[key] = {
      name: entry.name,
      limits: entry.limits || '',
      cardRequired: !!entry.card_required,
      quotas: entry.quotas || [],
      lastVerified: entry.last_verified || null
    };

    const modelIds = entry.api?.model_ids || [];
    if (Array.isArray(modelIds) && modelIds.length > 0) {
      providerCatalog[key] = modelIds;
    }
  }

  return { quotas, providerCatalog };
}

/**
 * Parse README.en.md from peter123023/awesome-free-llm-api for deprecations and live channels.
 */
function parseReadmeContent(content) {
  const deprecated = [];
  const deprecatedRecords = [];
  const lines = String(content).split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Strikethrough match: ~~Model Name~~
    const strikeMatch = trimmed.match(/~~([^~]+)~~/);
    if (strikeMatch) {
      const modelName = strikeMatch[1].trim();
      if (modelName && modelName.length >= 3 && modelName.length <= 50 && !modelName.includes('http') && !deprecated.includes(modelName)) {
        deprecated.push(modelName);
        deprecatedRecords.push({
          modelId: modelName,
          reason: 'Strikethrough in awesome-free-llm-api README'
        });
      }
    }
    // Explicit deprecation note in headings: e.g. "### Model Name (retired)"
    if (/retired|deprecated|offline|410 gone|shutdown/i.test(trimmed) && trimmed.startsWith('#')) {
      const cleanHeading = trimmed.replace(/^#+\s*/, '').replace(/\s*\([^)]*\)/g, '').replace(/~~[^~]+~~/g, '').trim();
      if (cleanHeading && cleanHeading.length >= 3 && cleanHeading.length <= 50 && !cleanHeading.includes('http') && !deprecated.includes(cleanHeading)) {
        deprecated.push(cleanHeading);
        deprecatedRecords.push({
          modelId: cleanHeading,
          reason: 'Retired heading in awesome-free-llm-api README'
        });
      }
    }
  }

  return { deprecated, deprecatedRecords };
}

/**
 * Parse https://models.dev/api.json for free models, context lengths, and deprecations.
 */
function parseModelsDevContent(content) {
  const data = typeof content === 'string' ? JSON.parse(content) : content;
  const models = [];
  const providerCatalog = {};
  const deprecated = [];
  const deprecatedRecords = [];

  for (const [providerKey, providerData] of Object.entries(data)) {
    if (!providerData || typeof providerData !== 'object') continue;
    const rawModels = providerData.models || {};
    const pKey = String(providerKey).toLowerCase();

    for (const [modelId, modelMeta] of Object.entries(rawModels)) {
      if (!modelMeta || typeof modelMeta !== 'object') continue;
      const cost = modelMeta.cost || {};
      const inputCost = Number(cost.input ?? -1);
      const outputCost = Number(cost.output ?? -1);
      const isZeroCost = (inputCost === 0 && outputCost === 0);
      const isFreeId = String(modelId).endsWith(':free') || String(modelMeta.id || '').endsWith(':free');

      const isDeprecated = modelMeta.status === 'deprecated' || modelMeta.status === 'shutdown';
      if (isDeprecated) {
        const isAggregator = ['aihubmix', 'opper', 'kenari', 'unorouter', 'github-copilot', 'poe', 'venice'].includes(pKey);
        if (!isAggregator) {
          deprecated.push(modelId);
          if (modelMeta.name && !modelMeta.name.includes(' ')) deprecated.push(modelMeta.name);
          deprecatedRecords.push({
            modelId,
            name: modelMeta.name || modelId,
            provider: pKey,
            reason: `Deprecated status in models.dev (${modelMeta.status})`
          });
        }
        // Do NOT add deprecated models to active pool
        continue;
      }

      if (isZeroCost || isFreeId) {
        const ctx = typeof modelMeta.limit?.context === 'number' ? modelMeta.limit.context : 131072;
        const modelObj = {
          id: modelId,
          name: modelMeta.name || modelId,
          tier: 'A',
          score: modelMeta.reasoning ? 75 : 60,
          contextLength: ctx,
          provider: pKey,
          addedDate: modelMeta.release_date || modelMeta.last_updated || null,
          deprecatedAfter: null,
          capabilities: {
            tools: modelMeta.tool_call !== false,
            reasoning: Boolean(modelMeta.reasoning)
          }
        };
        models.push(modelObj);
        if (!providerCatalog[pKey]) providerCatalog[pKey] = [];
        if (!providerCatalog[pKey].includes(modelId)) providerCatalog[pKey].push(modelId);
      }
    }
  }

  return { models, providerCatalog, deprecated, deprecatedRecords };
}

/**
 * Parse https://ai-gateway.kilo.ai/api/v1/models for live free tier models.
 */
function parseKiloGatewayContent(content) {
  const data = typeof content === 'string' ? JSON.parse(content) : content;
  const rawList = Array.isArray(data) ? data : (data.data || []);
  const models = [];
  const providerCatalog = { kilo: [] };

  for (const m of rawList) {
    if (!m || !m.id) continue;
    const id = String(m.id);
    const isFree = id.endsWith(':free') || m.is_free === true || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
    if (!isFree) continue;

    const ctx = Number(m.context_length || 131072);
    const modelObj = {
      id,
      name: m.name || id,
      tier: 'A',
      score: id.includes('beam') || id.includes('flint') ? 80 : 65,
      contextLength: ctx,
      provider: 'kilo',
      isFree: true
    };
    models.push(modelObj);
    providerCatalog.kilo.push(id);
  }

  return { models, providerCatalog };
}

/**
 * Consolidated Harvester: pull from all sources and write external-models.json.
 */
async function harvestExternalModels({
  outputPath = EXTERNAL_MODELS_PATH,
  deadModelsPath = DEAD_MODELS_PATH,
  retries = 3,
  baseDelayMs = 1000,
  timeoutMs = 15000,
  fetchImpl = null
} = {}) {
  console.log('[*] Harvesting external free model catalogs & benchmarks...');

  let sourcesText = null;
  let indexJson = null;
  let readmeText = null;

  const sourcesStatus = {
    'vava-nessa': { status: 'failed', count: 0 },
    'mvalentsev': { status: 'failed', count: 0 },
    'peter123023': { status: 'failed', count: 0 },
    'models.dev': { status: 'failed', count: 0 },
    'kilo.ai': { status: 'failed', count: 0 }
  };
  let modelsDevJson = null;
  let kiloGatewayJson = null;

  // 1. Fetch vava-nessa/free-coding-models
  try {
    sourcesText = await fetchWithBackoff(SOURCES_JS_URL, { retries, baseDelayMs, timeoutMs, fetchImpl });
    sourcesStatus['vava-nessa'].status = 'ok';
  } catch (err) {
    console.warn(`[!] Warning: Failed to fetch vava-nessa sources.js: ${err.message}`);
  }

  // 2. Fetch mvalentsev/awesome-free-ai-coding
  try {
    const rawIndex = await fetchWithBackoff(INDEX_JSON_URL, { retries, baseDelayMs, timeoutMs, fetchImpl });
    indexJson = JSON.parse(rawIndex);
    sourcesStatus['mvalentsev'].status = 'ok';
  } catch (err) {
    console.warn(`[!] Warning: Failed to fetch mvalentsev index.json: ${err.message}`);
  }

  // 3. Fetch peter123023/awesome-free-llm-api
  try {
    readmeText = await fetchWithBackoff(README_EN_URL, { retries, baseDelayMs, timeoutMs, fetchImpl });
    sourcesStatus['peter123023'].status = 'ok';
  } catch (err) {
    console.warn(`[!] Warning: Failed to fetch peter123023 README.en.md: ${err.message}`);
  }

  // 4. Fetch models.dev/api.json
  try {
    const rawModelsDev = await fetchWithBackoff(MODELS_DEV_URL, { retries, baseDelayMs, timeoutMs, fetchImpl });
    modelsDevJson = JSON.parse(rawModelsDev);
    sourcesStatus['models.dev'].status = 'ok';
  } catch (err) {
    console.warn(`[!] Warning: Failed to fetch models.dev api.json: ${err.message}`);
  }

  // 5. Fetch ai-gateway.kilo.ai/api/v1/models
  try {
    const rawKilo = await fetchWithBackoff(KILO_GATEWAY_URL, { retries, baseDelayMs, timeoutMs, fetchImpl });
    kiloGatewayJson = JSON.parse(rawKilo);
    sourcesStatus['kilo.ai'].status = 'ok';
  } catch (err) {
    console.warn(`[!] Warning: Failed to fetch kilo.ai models: ${err.message}`);
  }

  // Parse or fallback
  let parsedSources = { models: [], providerCatalog: {} };
  if (sourcesText) {
    try {
      parsedSources = await parseSourcesContent(sourcesText);
      sourcesStatus['vava-nessa'].count = parsedSources.models.length;
    } catch (e) {
      console.warn(`[!] Failed to parse sources.js: ${e.message}`);
    }
  }

  let parsedIndex = { quotas: {}, providerCatalog: {} };
  if (indexJson) {
    try {
      parsedIndex = parseIndexJsonContent(indexJson);
      sourcesStatus['mvalentsev'].count = Object.keys(parsedIndex.quotas).length;
    } catch (e) {
      console.warn(`[!] Failed to parse index.json: ${e.message}`);
    }
  }

  let parsedReadme = { deprecated: [] };
  if (readmeText) {
    try {
      parsedReadme = parseReadmeContent(readmeText);
      sourcesStatus['peter123023'].count = parsedReadme.deprecated.length;
    } catch (e) {
      console.warn(`[!] Failed to parse README.en.md: ${e.message}`);
    }
  }

  let parsedModelsDev = { models: [], providerCatalog: {}, deprecated: [] };
  if (modelsDevJson) {
    try {
      parsedModelsDev = parseModelsDevContent(modelsDevJson);
      sourcesStatus['models.dev'].count = parsedModelsDev.models.length;
    } catch (e) {
      console.warn(`[!] Failed to parse models.dev api.json: ${e.message}`);
    }
  }

  let parsedKilo = { models: [], providerCatalog: {} };
  if (kiloGatewayJson) {
    try {
      parsedKilo = parseKiloGatewayContent(kiloGatewayJson);
      sourcesStatus['kilo.ai'].count = parsedKilo.models.length;
    } catch (e) {
      console.warn(`[!] Failed to parse kilo.ai models: ${e.message}`);
    }
  }

  // Combine provider catalogs
  const mergedProviderCatalog = { ...parsedSources.providerCatalog };
  for (const [pKey, models] of Object.entries(parsedIndex.providerCatalog)) {
    if (!mergedProviderCatalog[pKey]) {
      mergedProviderCatalog[pKey] = models;
    } else {
      for (const m of models) {
        if (!mergedProviderCatalog[pKey].includes(m)) {
          mergedProviderCatalog[pKey].push(m);
        }
      }
    }
  }

  for (const [pKey, models] of Object.entries(parsedModelsDev.providerCatalog)) {
    if (!mergedProviderCatalog[pKey]) {
      mergedProviderCatalog[pKey] = models;
    } else {
      for (const m of models) {
        if (!mergedProviderCatalog[pKey].includes(m)) {
          mergedProviderCatalog[pKey].push(m);
        }
      }
    }
  }

  for (const [pKey, models] of Object.entries(parsedKilo.providerCatalog)) {
    if (!mergedProviderCatalog[pKey]) {
      mergedProviderCatalog[pKey] = models;
    } else {
      for (const m of models) {
        if (!mergedProviderCatalog[pKey].includes(m)) {
          mergedProviderCatalog[pKey].push(m);
        }
      }
    }
  }

  // Combine models list across sources
  const mergedModels = [...parsedSources.models];
  for (const devModel of parsedModelsDev.models) {
    if (!mergedModels.some(m => m.id === devModel.id && m.provider === devModel.provider)) {
      mergedModels.push(devModel);
    }
  }
  for (const kiloModel of parsedKilo.models) {
    if (!mergedModels.some(m => m.id === kiloModel.id && m.provider === kiloModel.provider)) {
      mergedModels.push(kiloModel);
    }
  }

  // Combine deprecations
  const mergedDeprecated = Array.from(new Set([...parsedReadme.deprecated, ...parsedModelsDev.deprecated]));

  // Combine structured deprecation records across all sources
  const allDeprecatedRecords = [
    ...(parsedSources.deprecatedRecords || []),
    ...(parsedModelsDev.deprecatedRecords || []),
    ...(parsedReadme.deprecatedRecords || [])
  ];

  // Compare against previous external catalog to detect models removed from external repo
  if (fs.existsSync(outputPath) && sourcesStatus['vava-nessa'].status === 'ok' && sourcesStatus['models.dev'].status === 'ok') {
    try {
      const prevData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      const prevCatalog = prevData.providerCatalog || {};
      for (const [pKey, oldModels] of Object.entries(prevCatalog)) {
        if (!Array.isArray(oldModels)) continue;
        const newModels = mergedProviderCatalog[pKey] || [];
        for (const oldId of oldModels) {
          if (!newModels.includes(oldId) && !mergedModels.some(m => m.id === oldId && m.provider === pKey)) {
            allDeprecatedRecords.push({
              modelId: oldId,
              provider: pKey,
              reason: `Removed from upstream ${pKey} external catalog`
            });
          }
        }
      }
    } catch {}
  }

  // Populate dead-models.json with confirmed dead models
  const targetDeadPath = deadModelsPath || DEAD_MODELS_PATH;
  let deadStore = { updatedAt: new Date().toISOString(), models: {} };
  if (fs.existsSync(targetDeadPath)) {
    try {
      deadStore = JSON.parse(fs.readFileSync(targetDeadPath, 'utf8'));
      if (!deadStore.models) deadStore.models = {};
    } catch {}
  }

  const now = new Date().toISOString();

  // Clean up any stale future-dated deprecations or bare keys without prefix in deadStore
  for (const [k, v] of Object.entries(deadStore.models)) {
    if (!k.includes('/')) {
      delete deadStore.models[k];
      continue;
    }
    const match = (v.reason || '').match(/Deprecated after ([0-9]{4}-[0-9]{2}-[0-9]{2})/);
    if (match) {
      const depDate = new Date(match[1]).getTime();
      if (!isNaN(depDate) && depDate > Date.now()) {
        delete deadStore.models[k];
      }
    }
  }

  // Ensure all existing entries in deadStore are marked confirmedDead without failCount
  for (const [mId, mData] of Object.entries(deadStore.models)) {
    if (!mData) continue;
    mData.confirmedDead = true;
    if (!mData.confirmedDeadAt) mData.confirmedDeadAt = mData.lastSeenDead || now;
    if ('failCount' in mData) delete mData.failCount;
  }

  const stdPrefixes = (providersHelper && providersHelper.STANDARD_PROVIDER_PREFIXES) || {
    openrouter: 'openrouter', nvidia: 'nvidia', groq: 'groq', cerebras: 'cerebras',
    ollama: 'ollama', kilo: 'kc', kilocode: 'kc', mistral: 'mistral',
    gemini: 'gemini', googleai: 'gemini', google: 'gemini', aihubmix: 'aihubmix',
    opencode: 'oc', 'opencode-zen': 'ocz', 'opencode-go': 'ocg', xai: 'xai'
  };

  for (const depRec of allDeprecatedRecords) {
    if (!depRec || !depRec.modelId) continue;
    const pKey = depRec.provider ? String(depRec.provider).toLowerCase() : '';
    const prefix = stdPrefixes[pKey] || pKey;
    const fullId = (providersHelper && typeof providersHelper.formatRoutingFullId === 'function' && prefix)
      ? providersHelper.formatRoutingFullId(prefix, depRec.modelId)
      : (prefix ? `${prefix}/${depRec.modelId}` : depRec.modelId);

    const existing = deadStore.models[fullId];
    deadStore.models[fullId] = {
      firstSeenDead: existing?.firstSeenDead || now,
      lastSeenDead: now,
      status: 410,
      reason: depRec.reason || 'Deprecated / removed upstream in external catalog',
      confirmedDead: true,
      confirmedDeadAt: existing?.confirmedDeadAt || now
    };
  }

  deadStore.updatedAt = now;
  try {
    fs.writeFileSync(targetDeadPath, JSON.stringify(deadStore, null, 2) + '\n', 'utf8');
    const confirmedCount = Object.values(deadStore.models).filter(m => m.confirmedDead).length;
    console.log(`[✓] Updated ${targetDeadPath} (${Object.keys(deadStore.models).length} entries, ${confirmedCount} confirmed dead)`);
  } catch (err) {
    console.warn(`[!] Warning: Failed to save ${targetDeadPath}: ${err.message}`);
  }

  // Filter out any confirmed dead models from active external-models.json catalog
  const filteredModels = mergedModels.filter(m => {
    const pKey = String(m.provider || '').toLowerCase();
    const prefix = stdPrefixes[pKey] || pKey;
    const fullId = (providersHelper && typeof providersHelper.formatRoutingFullId === 'function' && prefix)
      ? providersHelper.formatRoutingFullId(prefix, m.id)
      : (prefix ? `${prefix}/${m.id}` : m.id);
    if (deadStore.models[fullId]?.confirmedDead) return false;
    return true;
  });

  const filteredProviderCatalog = {};
  for (const [pKey, mList] of Object.entries(mergedProviderCatalog)) {
    const prefix = stdPrefixes[pKey] || pKey;
    filteredProviderCatalog[pKey] = mList.filter(mId => {
      const fullId = (providersHelper && typeof providersHelper.formatRoutingFullId === 'function' && prefix)
        ? providersHelper.formatRoutingFullId(prefix, mId)
        : (prefix ? `${prefix}/${mId}` : mId);
      if (deadStore.models[fullId]?.confirmedDead) return false;
      return true;
    });
  }

  // Fallback defaults if all networks failed and file doesn't exist
  if (filteredModels.length === 0 && fs.existsSync(outputPath)) {
    console.log(`[i] Using existing cached ${outputPath}`);
    try {
      return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch {}
  }

  const catalog = {
    lastUpdated: new Date().toISOString(),
    sources: sourcesStatus,
    models: filteredModels,
    providerCatalog: filteredProviderCatalog,
    quotas: parsedIndex.quotas,
    deprecated: mergedDeprecated
  };

  try {
    fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`[✓] Successfully harvested ${catalog.models.length} models across ${Object.keys(catalog.providerCatalog).length} providers into ${outputPath}`);
  } catch (err) {
    console.error(`[!] Failed to save ${outputPath}: ${err.message}`);
  }

  return catalog;
}

// Direct execution CLI
if (require.main === module) {
  harvestExternalModels()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[X] Harvester failed:', err);
      process.exit(1);
    });
}

module.exports = {
  fetchWithBackoff,
  parseContextLength,
  parseSourcesContent,
  parseIndexJsonContent,
  parseReadmeContent,
  harvestExternalModels,
  SOURCES_JS_URL,
  INDEX_JSON_URL,
  README_EN_URL,
  MODELS_DEV_URL,
  KILO_GATEWAY_URL,
  parseModelsDevContent,
  parseKiloGatewayContent,
  EXTERNAL_MODELS_PATH,
  DEAD_MODELS_PATH
};
