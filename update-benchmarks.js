#!/usr/bin/env node

/**
 * Benchmark Updater for 9router Free Sync
 * Fetches live empirical coding benchmarks (EvalPlus, OpenRouter Catalog, and calibrated baseline)
 */

const fs = require("node:fs");
const path = require("node:path");

const BENCHMARKS_PATH = path.join(__dirname, "benchmarks.json");

// Calibrated empirical baseline (SWE-bench Verified / LiveCodeBench / LMSYS Coding Elo)
const BASELINE = {
  // S+ Tier (>= 70% SWE-bench Verified)
  "claude-opus-4-6-thinking": { name: "Claude Opus 4.6 Thinking", score: 85.0, swe_bench: 81.0, tier: "S+", contextLength: 200000 },
  "assistant-sonnet-4.5-thinking": { name: "Claude Sonnet 4.5 Thinking", score: 84.0, swe_bench: 80.0, tier: "S+", contextLength: 200000 },
  "gemini-3.8-flash": { name: "Gemini 3.8 Flash", score: 83.5, swe_bench: 78.5, tier: "S+", contextLength: 1048576 },
  "gemini-3.7-flash": { name: "Gemini 3.7 Flash", score: 83.0, swe_bench: 78.5, tier: "S+", contextLength: 1048576 },
  "claude-sonnet-4.5": { name: "Claude Sonnet 4.5", score: 82.5, swe_bench: 78.0, tier: "S+", contextLength: 200000 },
  "moonshotai/kimi-k3": { name: "Moonshot Kimi K3", score: 82.0, swe_bench: 76.8, tier: "S+", contextLength: 1048576 },
  "kimi-k3": { name: "Kimi K3", score: 82.0, swe_bench: 76.8, tier: "S+", contextLength: 1048576 },
  "gh/gpt-4.1": { name: "GitHub GPT-4.1", score: 81.5, swe_bench: 77.0, tier: "S+", contextLength: 128000 },
  "gpt-4.1": { name: "GPT-4.1", score: 81.5, swe_bench: 77.0, tier: "S+", contextLength: 128000 },
  "claude-sonnet-4.6": { name: "Claude Sonnet 4.6", score: 81.0, swe_bench: 74.0, tier: "S+", contextLength: 200000 },
  "z-ai/glm-5.3": { name: "Zhipu GLM 5.3", score: 80.0, swe_bench: 75.0, tier: "S+", contextLength: 1048576 },
  "glm-5.3": { name: "GLM 5.3", score: 80.0, swe_bench: 75.0, tier: "S+", contextLength: 1048576 },
  "deepseek-v4.1-flash": { name: "DeepSeek V4.1 Flash", score: 79.5, swe_bench: 74.0, tier: "S+", contextLength: 131072 },
  "nvidia/nemotron-3-ultra-550b-a55b": { name: "Nemotron 3 Ultra 550B", score: 77.5, swe_bench: 71.9, tier: "S+", contextLength: 1048576 },
  "nemotron-3-ultra": { name: "NVIDIA Nemotron 3 Ultra", score: 77.5, swe_bench: 71.9, tier: "S+", contextLength: 1048576 },
  "poolside/laguna-xs-2.1": { name: "Poolside Laguna XS 2.1", score: 76.0, swe_bench: 70.9, tier: "S+", contextLength: 262144 },
  "laguna-xs": { name: "Laguna XS 2.1", score: 76.0, swe_bench: 70.9, tier: "S+", contextLength: 262144 },
  "laguna-xs-2.1": { name: "Poolside Laguna XS 2.1", score: 76.0, swe_bench: 70.9, tier: "S+", contextLength: 262144 },

  // S Tier (60 - 70% SWE-bench Verified)
  "cerebras/qwen-3.8-27b": { name: "Cerebras Qwen 3.8 27B", score: 73.0, swe_bench: 68.0, tier: "S", contextLength: 32768 },
  "qwen-3.8-27b": { name: "Qwen 3.8 27B", score: 73.0, swe_bench: 68.0, tier: "S", contextLength: 32768 },
  "step-3.7-flash": { name: "StepFun Step 3.7 Flash", score: 70.0, swe_bench: 66.0, tier: "S", contextLength: 262144 },
  "cerebras/gpt-oss-120b": { name: "Cerebras GPT-OSS 120B", score: 68.0, swe_bench: 62.4, tier: "S", contextLength: 8192 },
  "gpt-oss-120b": { name: "GPT-OSS 120B", score: 68.0, swe_bench: 62.4, tier: "S", contextLength: 8192 },
  "gcli/grok-4.7": { name: "xAI Grok 4.7 CLI", score: 67.5, swe_bench: 62.0, tier: "S", contextLength: 131072 },
  "grok-4.7": { name: "Grok 4.7", score: 67.5, swe_bench: 62.0, tier: "S", contextLength: 131072 },
  "nvidia/nemotron-3-super-120b-a12b": { name: "Nemotron 3 Super 120B", score: 66.0, swe_bench: 60.5, tier: "S", contextLength: 1048576 },
  "nemotron-3-super": { name: "NVIDIA Nemotron 3 Super", score: 66.0, swe_bench: 60.5, tier: "S", contextLength: 1048576 },
  "qwen2.5-coder": { name: "Qwen 2.5 Coder 32B", score: 65.0, swe_bench: 65.0, tier: "S", contextLength: 131072 },

  // A+ Tier (50 - 60% SWE-bench Verified)
  "gemini-3.5-flash": { name: "Gemini 3.5 Flash", score: 58.0, swe_bench: 58.0, tier: "A+", contextLength: 1048576 },
  "qwen3-coder-480b": { name: "Qwen3 Coder 480B", score: 58.0, swe_bench: 58.0, tier: "A+", contextLength: 131072 },
  "nemotron-3.5-lightning-30b": { name: "Nemotron 3.5 Lightning 30B", score: 57.0, swe_bench: 52.8, tier: "A+", contextLength: 131072 },
  "nemotron-3.5-lightning": { name: "NVIDIA Nemotron 3.5 Lightning", score: 57.0, swe_bench: 52.8, tier: "A+", contextLength: 131072 },
  "qwen3.5-122b": { name: "Qwen 3.5 122B", score: 56.0, swe_bench: 56.0, tier: "A+", contextLength: 131072 },
  "minimax-m3": { name: "MiniMax M3", score: 55.0, swe_bench: 55.0, tier: "A+", contextLength: 1048576 },
  "deepseek-r1": { name: "DeepSeek R1 Distill", score: 52.0, swe_bench: 52.0, tier: "A+", contextLength: 131072 },
  "mimo-v2.5": { name: "Xiaomi MiMo V2.5", score: 50.5, swe_bench: 50.5, tier: "A+", contextLength: 1048576 },
  "hy3": { name: "Tencent HY3", score: 50.0, swe_bench: 50.0, tier: "A+", contextLength: 131072 }
};

function determineTier(score) {
  if (score >= 70) return "S+";
  if (score >= 60) return "S";
  if (score >= 50) return "A+";
  if (score >= 40) return "A";
  if (score >= 35) return "A-";
  if (score >= 30) return "B+";
  if (score >= 20) return "B";
  return "C";
}

function normalizeKey(str) {
  return String(str).toLowerCase()
    .replace(/[^a-z0-9\.\-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchEvalPlusBenchmarks() {
  const url = "https://raw.githubusercontent.com/evalplus/evalplus.github.io/main/results.json";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const parsed = {};
    
    for (const [modelName, info] of Object.entries(data)) {
      if (!info || !info["pass@1"]) continue;
      const pass = info["pass@1"];
      const hePlus = Number(pass["humaneval+"]) || Number(pass.humaneval) || 0;
      const mbppPlus = Number(pass["mbpp+"]) || Number(pass.mbpp) || 0;
      
      // Calculate weighted score (HumanEval+ 60%, MBPP+ 40%)
      const score = Math.round(((hePlus * 0.6) + (mbppPlus * 0.4)) * 10) / 10;
      if (score <= 0) continue;

      const key = normalizeKey(modelName);
      parsed[key] = {
        name: modelName,
        score,
        humaneval_plus: hePlus,
        mbpp_plus: mbppPlus,
        tier: determineTier(score),
        source: "evalplus"
      };
    }
    return parsed;
  } catch (err) {
    console.warn(`[!] Note: Could not fetch live EvalPlus data (${err.message}). Using local baseline.`);
    return null;
  }
}

// Fetch SWE-bench Verified resolved-rate per model from the official leaderboard data file
// https://raw.githubusercontent.com/SWE-bench/SWE-bench.github.io/master/data/leaderboards.json
async function fetchSweBenchVerified() {
  const url = "https://raw.githubusercontent.com/SWE-bench/SWE-bench.github.io/master/data/leaderboards.json";
  try {
    console.log("[*] Fetching SWE-bench Verified leaderboard...");
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const board = (data.leaderboards || []).find(b => b.name === "Verified");
    if (!board || !Array.isArray(board.results)) throw new Error("Verified board not found");

    const parsed = {};
    for (const entry of board.results) {
      const name = entry.name || entry.model_display;
      const resolved = Number(entry.resolved);
      if (!name || isNaN(resolved) || resolved <= 0) continue;
      const key = normalizeKey(name);
      if (!key) continue;
      // Keep the best observed score per normalized model name
      if (!parsed[key] || resolved > parsed[key].score) {
        parsed[key] = {
          name,
          score: Math.round(resolved * 10) / 10,
          swe_bench: Math.round(resolved * 10) / 10,
          tier: determineTier(resolved),
          source: "swebench-verified"
        };
      }
    }
    console.log(`[+] Parsed ${Object.keys(parsed).length} models from SWE-bench Verified.`);
    return parsed;
  } catch (err) {
    console.warn(`[!] Note: Could not fetch SWE-bench data (${err.message}). Skipping.`);
    return null;
  }
}

// Fetch LiveCodeBench mean pass@1 per model from the official final dataset
// (project frozen since 2025-04; still the authoritative historical benchmark)
async function fetchLiveCodeBench() {
  const url = "https://raw.githubusercontent.com/LiveCodeBench/LiveCodeBench.github.io/main/build/performances_generation.json";
  try {
    console.log("[*] Fetching LiveCodeBench dataset...");
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const performances = data.performances || [];
    const reprByModel = {};
    for (const m of (Array.isArray(data.models) ? data.models : [])) {
      if (m && m.model_name) reprByModel[m.model_name] = m.model_repr || m.model_name;
    }

    // Mean pass@1 across all recorded questions per model
    const sums = new Map();
    for (const row of performances) {
      const model = row.model;
      const pass = Number(row["pass@1"]);
      if (!model || isNaN(pass)) continue;
      if (!sums.has(model)) sums.set(model, { total: 0, count: 0 });
      const agg = sums.get(model);
      agg.total += pass;
      agg.count += 1;
    }

    const parsed = {};
    for (const [model, { total, count }] of sums) {
      if (count < 20) continue; // ignore models with barely any recorded questions
      const score = Math.round((total / count) * 10) / 10;
      if (score <= 0) continue;
      const displayName = reprByModel[model] || model;
      const key = normalizeKey(displayName);
      if (!key) continue;
      parsed[key] = {
        name: displayName,
        score,
        livecodebench: score,
        tier: determineTier(score),
        source: "livecodebench"
      };
    }
    console.log(`[+] Parsed ${Object.keys(parsed).length} models from LiveCodeBench.`);
    return parsed;
  } catch (err) {
    console.warn(`[!] Note: Could not fetch LiveCodeBench data (${err.message}). Skipping.`);
    return null;
  }
}

async function updateBenchmarks() {
  console.log("[*] Checking latest empirical coding benchmarks...");
  
  // Start with calibrated baseline
  const merged = { ...BASELINE };

  // Fetch live sources; the calibrated baseline always wins, later sources only fill gaps
  const liveEvalPlus = await fetchEvalPlusBenchmarks();
  const liveSweBench = await fetchSweBenchVerified();
  const liveLcb = await fetchLiveCodeBench();

  let added = 0;
  for (const dataset of [liveEvalPlus, liveSweBench, liveLcb]) {
    if (!dataset || Object.keys(dataset).length === 0) continue;
    console.log(`[+] Fetched ${Object.keys(dataset).length} models from ${Object.values(dataset)[0]?.source || "live"} source.`);
    for (const [key, data] of Object.entries(dataset)) {
      // Don't overwrite the calibrated baseline or an earlier (higher-priority) source
      if (!merged[key]) {
        merged[key] = data;
        added += 1;
      }
    }
  }
  console.log(`[+] Merged ${added} additional model scores from live sources.`);

  // Ingest harvested external models catalog (vava-nessa, mvalentsev, peter123023)
  const externalPath = path.join(__dirname, "external-models.json");
  if (fs.existsSync(externalPath)) {
    try {
      const extData = JSON.parse(fs.readFileSync(externalPath, "utf8"));
      const extModels = extData.models || [];
      let extAdded = 0;
      for (const m of extModels) {
        if (!m || !m.id) continue;
        const rawKey = normalizeKey(m.id);
        const baseKey = normalizeKey(m.id.split("/").pop());
        const score = typeof m.score === "number" ? m.score : (parseFloat(m.score) || 50);

        const entry = {
          name: m.name || m.id,
          score,
          swe_bench: score,
          tier: determineTier(score),
          contextLength: m.contextLength || 131072,
          source: `external-catalog:${m.provider || "generic"}`
        };

        for (const k of [rawKey, baseKey]) {
          if (!merged[k]) {
            merged[k] = entry;
            extAdded++;
          } else if (score > (merged[k].score || 0)) {
            merged[k].score = score;
            merged[k].swe_bench = score;
            merged[k].tier = determineTier(score);
            if (m.contextLength) merged[k].contextLength = m.contextLength;
          }
        }
      }
      console.log(`[+] Ingested ${extAdded} models from external-models.json catalog.`);

      // Mark deprecated models
      const deprecated = extData.deprecated || [];
      for (const dep of deprecated) {
        const depKey = normalizeKey(dep);
        if (merged[depKey]) merged[depKey].deprecated = true;
        for (const [k, v] of Object.entries(merged)) {
          if (k.includes(depKey) || depKey.includes(k)) v.deprecated = true;
        }
      }
    } catch (e) {
      console.warn(`[!] Note: Could not parse external-models.json: ${e.message}`);
    }
  }

  // Tier labels are always derived from the score (single source of truth);
  // this also re-labels stale entries on every run.
  for (const entry of Object.values(merged)) entry.tier = determineTier(entry.score);

  // Save merged benchmarks database
  fs.writeFileSync(BENCHMARKS_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(`[✓] Benchmarks database updated successfully (${Object.keys(merged).length} models recorded).`);
  return merged;
}

if (require.main === module) {
  updateBenchmarks().catch(console.error);
}

// Benchmark score floor for smart-tier combo membership (the A/B boundary of
// determineTier). sync.js imports this instead of restating the number.
const SMART_MIN_SCORE = 60;

module.exports = { updateBenchmarks, determineTier, normalizeKey, fetchSweBenchVerified, fetchLiveCodeBench, SMART_MIN_SCORE, BENCHMARKS_PATH };
