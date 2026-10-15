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
const EXTERNAL_MODELS_PATH = path.join(__dirname, 'external-models.json');

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

/**
 * Parse sources.js content from vava-nessa/free-coding-models.
 */
async function parseSourcesContent(content) {
  const models = [];
  const providerCatalog = {};

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
        const modelObj = {
          id: modelId,
          name: label || modelId,
          tier: tier || 'A',
          score: typeof sweScore === 'number' ? sweScore : parseFloat(sweScore) || 50,
          contextLength: parseContextLength(ctx),
          provider: providerKey,
          addedDate: addedDate || null,
          deprecatedAfter: deprecatedAfter || null
        };
        models.push(modelObj);
        providerCatalog[providerKey].push(modelId);
      }
    }

    // Also parse flat MODELS if present and providerCatalog didn't catch everything
    if (Array.isArray(mod.MODELS)) {
      for (const m of mod.MODELS) {
        if (!Array.isArray(m)) continue;
        const [modelId, label, tier, sweScore, ctx, providerKey, addedDate] = m;
        if (!models.some(existing => existing.id === modelId && existing.provider === providerKey)) {
          const modelObj = {
            id: modelId,
            name: label || modelId,
            tier: tier || 'A',
            score: typeof sweScore === 'number' ? sweScore : parseFloat(sweScore) || 50,
            contextLength: parseContextLength(ctx),
            provider: providerKey || 'general',
            addedDate: addedDate || null
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

  return { models, providerCatalog };
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
  const lines = String(content).split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Strikethrough match: ~~Model Name~~
    const strikeMatch = trimmed.match(/~~([^~]+)~~/);
    if (strikeMatch) {
      const modelName = strikeMatch[1].trim();
      if (modelName && !deprecated.includes(modelName)) {
        deprecated.push(modelName);
      }
    }
    // Explicit deprecation note
    if (/retired|deprecated|offline|410 gone|shutdown/i.test(trimmed) && trimmed.startsWith('#')) {
      const cleanHeading = trimmed.replace(/^#+\s*/, '').trim();
      if (cleanHeading && !deprecated.includes(cleanHeading)) {
        deprecated.push(cleanHeading);
      }
    }
  }

  return { deprecated };
}

/**
 * Consolidated Harvester: pull from all sources and write external-models.json.
 */
async function harvestExternalModels({
  outputPath = EXTERNAL_MODELS_PATH,
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
    'peter123023': { status: 'failed', count: 0 }
  };

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

  // Fallback defaults if all networks failed and file doesn't exist
  if (parsedSources.models.length === 0 && fs.existsSync(outputPath)) {
    console.log(`[i] Using existing cached ${outputPath}`);
    try {
      return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch {}
  }

  const catalog = {
    lastUpdated: new Date().toISOString(),
    sources: sourcesStatus,
    models: parsedSources.models,
    providerCatalog: mergedProviderCatalog,
    quotas: parsedIndex.quotas,
    deprecated: parsedReadme.deprecated
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
  EXTERNAL_MODELS_PATH
};
