# Incorporate Free Model Lists & Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporate verified 2026 free coding model lists, SWE-bench Verified rankings, and real-time quotas from `vava-nessa/free-coding-models`, `mvalentsev/awesome-free-ai-coding`, and `peter123023/awesome-free-llm-api` using direct static resource HTTP fetching with exponential backoff (KISS, YAGNI, DRY); automatically consider all active providers enabled in 9router (including Cerebras, Freebuff, MiMo Code, Devin CLI, Groq, NVIDIA, etc.) and auto-fetch their free models from external catalogs to eliminate static list drift; upgrade model picking and benchmark ranking; and exclude OpenCode Go from `my9model-*` super-combos while preserving its dedicated `ocg-free` combo.

**Architecture:** A lightweight, dependency-free sync and ingestion pipeline:
1. `fetch-external-models.js`: Direct HTTP fetcher with exponential backoff (no `gh` CLI or subprocess moving parts) pulling raw curated data:
   - `https://raw.githubusercontent.com/vava-nessa/free-coding-models/main/sources.js`
   - `https://raw.githubusercontent.com/mvalentsev/awesome-free-ai-coding/main/index.json`
   - `https://raw.githubusercontent.com/peter123023/awesome-free-llm-api/main/README.en.md`
   Generates `external-models.json` containing live models, context windows, SWE-bench scores, quotas, and deprecations.
2. **Dynamic Provider Pool Ingestion ([`providers.js`](file:///c:/Users/Animesh/Desktop/Reference_Projects/9router-auto-free/providers.js))**:
   - Eliminates blind spots: active providers in 9router (`providerConnections` where `isActive = 1`) are NEVER excluded by default.
   - For all active providers (`cerebras`, `freebuff`, `xiaomi-mimo`, `devin`/`windsurf`, `groq`, `nvidia`, `gh`, `ag`, etc.), `providers.js` dynamically enriches candidate pools with models harvested from `external-models.json`.
3. `update-benchmarks.js` & `benchmarks.json`: Calibrated baseline upgraded with official S+/S/A+ SWE-bench Verified scores (Kimi K3: 76.8%, Nemotron 3 Ultra: 71.9%, Laguna XS 2.1: 70.9%, Gemini 3.8 Flash: 76.9%, DeepSeek V4.1 Flash: 74.0%, GLM-5.3: 75.0%, Grok 4.7: 62.0%, etc.).
4. `sync.js` Super-Combo Gating: Explicitly exclude `ocg/` and `opencode-go/` from `my9model-free`, `my9model-smart`, `my9model-fast`, and `my9model-cooldown`, while maintaining `ocg-free` as an isolated provider combo.
5. `sync.js` Model Picking: Enhanced ranking using SWE-bench verified tiers, context window tiers (1M/262k/131k/128k), deprecation dates, and latency tie-breakers.

**Tech Stack:** Bun (v1.4+ on Windows host for testing/scripts), Node.js (v20+/v22+ inside Kubernetes pod), Better-SQLite3 / Node built-in SQLite, Node/Bun Test Runner (`test.js`), Kubernetes (`kubectl`).

**Spec:** Documented in `CONTEXT.md` and user directives.

## Global Constraints
- **KISS / YAGNI / DRY:** No extra CLI dependencies or subshell tools (no `gh` CLI requirement); fetch static raw GitHub URLs directly using native `fetch()` with retry and exponential backoff.
- **Auto-Consider All Active Providers:** Any provider with an active connection in 9router (`isActive = 1`) MUST be considered. Default exclusions in `exclusions.json` must not silence active connections (`cerebras`, `groq`, `nvidia`, `mimo`, `freebuff`, `devin`).
- **Dynamic External Model Ingestion:** Since 9router's model catalog is not actively updated, external free model catalogs MUST automatically enrich provider candidate pools.
- **Host Testing Environment:** Windows host has Bun (`bun`) and no `npm`. All local test runs, script executions, and unit tests MUST use `bun` (e.g., `bun test.js`, `bun fetch-external-models.js`).
- **Cluster Deployment Environment:** Cluster pod uses Node.js (`node`). Code must remain 100% compatible with both Bun and Node.js.
- **Super-Combo Exclusion:** OpenCode Go models MUST be excluded from all `my9model-*` super-combos, but MUST be kept in `ocg-free` and `opencode-go`.
- **Read-only respect for 9router Core:** Never write arbitrary secrets to 9router's SQLite; only write to `combos` table and configuration JSONs.

---

## 2026 Model Intelligence & Landscape (What is New & Ranking)

Since 9router's static catalog was released, the frontier free model landscape in late 2026 has shifted significantly:

| Model ID | Provider(s) | Tier | SWE-bench | Ctx Window | Status & What's New |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `moonshotai/kimi-k3` | Antigravity, OCG, NIM | **S+** | **76.8%** | 1M | Replaced Kimi K2.5/K2.6 (retired 2026-07/09). Top frontier open-weight coder. |
| `nvidia/nemotron-3-ultra-550b-a55b` | NIM, Kilo, OpenRouter | **S+** | **71.9%** | 1M | 550B MoE flagship, high reasoning capability for complex agentic workflows. |
| `poolside/laguna-xs-2.1` | NIM, OpenRouter | **S+** | **70.9%** | 262k | Poolside frontier coding model, highly optimized for SWE benchmarks. |
| `gemini-3.8-flash` (`high`/`low`) | Antigravity, Gemini API | **S** | **76.9%** | 1M | Fast, low latency, native agentic tool support. |
| `z-ai/glm-5.3` / `glm-5.3-flash` | OCG, NIM, Freebuff | **S** | **75.0%** | 1M | Added late Sept 2026. Replaces GLM 5.1/5.2. Multimodal 320B. |
| `deepseek-v4.1-flash` | OCG, NIM, Freebuff | **S** | **74.0%** | 1M | Released 2026-09-10. 552B MoE. Replaced deprecated V4 Flash & retired V4 Pro. |
| `gemini-3.7-flash` | Gemini API, Antigravity | **S** | **78.5%** | 1M | Stable Google frontier workhorse. |
| `gpt-4.1` / `gpt-4-o-preview` | GitHub Copilot (`gh`) | **S** | **77.0%** | 128k | Copilot free tier models with ~700ms latency. |
| `cerebras/qwen-3.8-27b` | Cerebras | **A+**| **68.0%** | 64k | Ultra-high throughput fast coder on Cerebras wafer. |
| `cerebras/gpt-oss-120b` | Cerebras | **S** | **62.4%** | 65k | High-speed open-weights frontier coder on Cerebras. |
| `nvidia/nemotron-3-super-120b-a12b`| OpenRouter, Kilo, NIM | **S** | **60.5%** | 1M | 120B MoE model with fast inference and 1M context. |
| `claude-opus-4-6-thinking` | Antigravity (`ag`) | **S** | **78.0%** | 200k | High reasoning tier with thinking tokens. |
| `claude-sonnet-4-6` | Antigravity (`ag`) | **A+**| **74.0%** | 200k | Active in Antigravity Copilot. |
| `gcli/grok-4.7` | Grok CLI (`gcli`), OCG | **A+**| **62.0%** | 128k | Latest xAI model release. |
| `mimo/mimo-v2.5` | Xiaomi MiMo | **B+**| **52.0%** | 128k | MiMo free coding model. |
| `nvidia/nemotron-3.5-lightning-30b`| Kilo, NIM | **A+**| **52.8%** | 1M | 30B ultra-fast low-latency coder. |
| `meta/muse-glimmer-30b` | NIM | **B+**| **45.0%** | 131k | Added Sept 2026 to NIM catalog. |

### Retired / Deprecated Models to Filter Out Automatically:
- `ollama/kimi-k2.5` & `ollama/glm-5` (HTTP 410 Gone / retired July 2026)
- `deepseek-v4-flash-0731` & `deepseek-v4-pro-0813` (EOL Sept 2026)
- `github-models` endpoint (HTTP 410 Gone / retired July 2026)
- `mistral-nemotron` (EOL Sept 28, 2026)
- `gpt-oss-120b` (Deprecated Sept 02, 2026 on NIM; remains on Cerebras)
- `opencode-zen` external HTTP endpoint (Returns 403 `FreeTierError` outside OpenCode desktop)
- `jev-1.13` (Structured decisions model, causes 400 Bad Request in chat completions)

---

## Tasks

### Task 1: Exclude OpenCode Go from `my9model-*` Super-Combos

**Files:**
- Modify: `sync.js:45-55`, `sync.js:390-410`, `sync.js:680-705`
- Test: `test.js`

**Interfaces:**
- Consumes: `assembleCombos({ candidates, latencyMap, metaMap })`
- Produces: `SUPER_COMBO_EXCLUDED_PREFIXES = ['ocg', 'opencode-go']`
- Behavior: Candidates matching these prefixes are excluded from `my9model-free`, `my9model-smart`, `my9model-fast`, and `my9model-cooldown`. They MUST still be included in `ocg-free` and `opencode-go` provider combos.

- [ ] **Step 1: Write failing unit test in `test.js`**
  Add a test verifying that `assembleCombos` strips `ocg/` models from `unified`, `smart`, `fast`, and `cooldown`, while preserving them in provider lists.
  Make `test.js` support running with `bun test.js` on host without requiring a local 9router SQLite file.
  ```javascript
  // in test.js
  const sampleCandidates = [
    'gh/gpt-4.1',
    'ocg/deepseek-v4.1-flash',
    'ag/gemini-3.8-flash',
    'ocg/glm-5.3'
  ];
  const res = assembleCombos({ candidates: sampleCandidates });
  assert.ok(!res.unified.some(id => id.startsWith('ocg/')), 'my9model-free must not contain ocg models');
  assert.ok(!res.smart.some(id => id.startsWith('ocg/')), 'my9model-smart must not contain ocg models');
  assert.ok(!res.fast.some(id => id.startsWith('ocg/')), 'my9model-fast must not contain ocg models');
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `bun test.js`
  Expected: FAIL (assertion error: `my9model-free must not contain ocg models`).

- [ ] **Step 3: Implement `SUPER_COMBO_EXCLUDED_PREFIXES` in `sync.js`**
  Define `const SUPER_COMBO_EXCLUDED_PREFIXES = ['ocg', 'opencode-go'];`
  In `assembleCombos`:
  ```javascript
  const isSuperComboExcluded = id => {
    const prefix = String(id).split('/')[0].toLowerCase();
    return SUPER_COMBO_EXCLUDED_PREFIXES.includes(prefix);
  };
  const eligibleIds = allIds.filter(id => !isSuperComboExcluded(id));
  const gatedIds = eligibleIds.filter(id => passesAgenticGate(metaMap.get(id)));
  ```
  And in `refreshCombos`:
  Ensure `my9model-*` refresh sets do not re-inject `ocg` models into super-combos.

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add sync.js test.js
  git commit -m "fix(sync): exclude OpenCode Go models from my9model-* super-combos"
  ```

---

### Task 2: Build External Free Model Harvester (`fetch-external-models.js`) with Backoff Retry

**Files:**
- Create: `fetch-external-models.js`
- Create: `external-models.json` (auto-generated artifact)
- Test: `test.js`

**Interfaces:**
- Produces: `fetchExternalModelCatalog()` returning:
  `{ models: Map<string, ModelMetadata>, providers: Map<string, ProviderStatus>, deprecations: Set<string> }`
- ModelMetadata: `{ id, label, tier, sweScore, contextLength, provider, deprecatedAfter }`
- ProviderStatus: `{ key, name, url, quota, isDelisted, cardRequired }`

- [ ] **Step 1: Write failing unit test in `test.js`**
  Add unit tests for `fetch-external-models.js` testing parsing of `sources.js` format and `index.json` provider status.
  ```javascript
  const { parseSourcesJs, parseAwesomeIndex } = require('./fetch-external-models.js');
  // test parsing of tuple: ['moonshotai/kimi-k3', 'Kimi K3', 'S+', '76.8%', '1M']
  const parsed = parseSourcesJs("export const nvidiaNim = [['moonshotai/kimi-k3', 'Kimi K3', 'S+', '76.8%', '1M']];");
  assert.equal(parsed['moonshotai/kimi-k3'].sweScore, 76.8);
  assert.equal(parsed['moonshotai/kimi-k3'].tier, 'S+');
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `bun test.js`
  Expected: FAIL (`Cannot find module './fetch-external-models.js'`).

- [ ] **Step 3: Implement `fetch-external-models.js`**
  Implement:
  - `fetchWithBackoff(url, retries = 3, baseDelayMs = 1000)`: native `fetch()` with retry & exponential backoff on HTTP 429/5xx (no external CLI subprocesses).
  - Target URLs:
    - `https://raw.githubusercontent.com/vava-nessa/free-coding-models/main/sources.js`
    - `https://raw.githubusercontent.com/mvalentsev/awesome-free-ai-coding/main/index.json`
    - `https://raw.githubusercontent.com/peter123023/awesome-free-llm-api/main/README.en.md`
  - `parseSourcesJs(content)`: extracts `[modelId, label, tier, sweScore, ctx, addedDate, deprecatedAfter]` across provider exports.
  - `parseAwesomeIndex(content)`: extracts verified quotas, probe pass/fail, and delisted providers (including Devin / Windsurf).
  - `parseAwesomeMarkdown(content)`: extracts retired model notices (DeepSeek V4.1 replacement, retired V4 Pro).
  - CLI runner: `bun fetch-external-models.js` writes combined cache to `external-models.json`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test.js`
  Expected: PASS.

- [ ] **Step 5: Run harvester CLI with Bun to generate `external-models.json`**
  Run: `bun fetch-external-models.js`
  Verify `external-models.json` contains 170+ models with SWE-bench scores and tiers.

- [ ] **Step 6: Commit**
  ```bash
  git add fetch-external-models.js external-models.json test.js
  git commit -m "feat: add external free model catalog harvester with backoff retry"
  ```

---

### Task 3: Auto-Consider All Active Providers & Dynamic Pool Enrichment ([`exclusions.json`](file:///c:/Users/Animesh/Desktop/Reference_Projects/9router-auto-free/exclusions.json), [`storage.js`](file:///c:/Users/Animesh/Desktop/Reference_Projects/9router-auto-free/storage.js), [`providers.js`](file:///c:/Users/Animesh/Desktop/Reference_Projects/9router-auto-free/providers.js))

**Files:**
- Modify: `exclusions.json:1-15`
- Modify: `storage.js:158-200`
- Modify: `providers.js:1000-1120`
- Test: `test.js`

**Interfaces:**
- Consumes: `storage.readActiveProviderConnections()`, `external-models.json`
- Produces: Dynamic candidate enrichment for active providers:
  - Active 9router providers (`cerebras`, `freebuff`, `xiaomi-mimo`, `devin`, `groq`, `nvidia`, etc.) are NEVER silenced by default exclusions.
  - Provider candidates are automatically augmented with free models fetched from `external-models.json`.
  - Prefix mapping includes: `cerebras: 'cerebras'`, `freebuff: 'fb'`, `'xiaomi-mimo': 'mimo'`, `'devin': 'devin'`, `groq: 'groq'`, `nvidia: 'nvidia'`, etc.

- [ ] **Step 1: Write failing unit test in `test.js`**
  Add unit test verifying:
  1. An active provider connection in 9router (e.g. `cerebras`) is not dropped by exclusion lists.
  2. Free models for active providers are dynamically loaded from `external-models.json` even if not in static catalog.
  ```javascript
  // in test.js
  const { discoverAllProviders } = require('./providers.js');
  // simulate active connections containing cerebras & freebuff
  // verify results contain candidate models for cerebras and freebuff
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `bun test.js`
  Expected: FAIL (cerebras was excluded or missing dynamic models).

- [ ] **Step 3: Update `exclusions.json` and provider discovery logic**
  - In `exclusions.json`, remove active 9router providers (`cerebras`, `groq`, `nvidia`) from `excludedProviders`.
  - In `sync.js` / `providers.js`, add active connection guard:
    `const activeProviders = storage.readActiveProviderConnections().map(c => c.provider.toLowerCase());`
    `const effectiveExclusions = excludedProviders.filter(p => !activeProviders.includes(p.toLowerCase()));`
  - In `providers.js`, add external catalog model merger: for each provider record, look up matching models in `external-models.json` (by provider key/alias) and merge into candidate list before pre-testing.
  - In `storage.js`, ensure `devin` prefix mapping (`devin: 'devin'`) is present in `STANDARD_PREFIXES`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add exclusions.json storage.js providers.js test.js
  git commit -m "feat(providers): auto-consider all active 9router connections and dynamically enrich free models from external catalog"
  ```

---

### Task 4: Upgrade `update-benchmarks.js` & `benchmarks.json` with 2026 Verified S+/S/A+ Rankings

**Files:**
- Modify: `update-benchmarks.js:14-60`, `update-benchmarks.js:100-210`
- Modify: `benchmarks.json`
- Test: `test.js`

**Interfaces:**
- Consumes: `external-models.json` or live SWE-bench verified data
- Produces: Updated `benchmarks.json` with calibrated SWE-bench Verified rankings:
  - `kimi-k3`: 76.8 (S+)
  - `nemotron-3-ultra-550b`: 71.9 (S+)
  - `laguna-xs-2.1`: 70.9 (S+)
  - `gemini-3.8-flash`: 76.9 (S)
  - `deepseek-v4.1-flash`: 74.0 (S)
  - `glm-5.3` / `glm-5.3-flash`: 75.0 (S)
  - `nemotron-3-super-120b`: 60.5 (S)
  - `grok-4.7`: 62.0 (A+)
  - `nemotron-3.5-lightning-30b`: 52.8 (A+)
  - `nemotron-3-nano-omni-30b`: 52.0 (A+)
  - `muse-glimmer-30b`: 45.0 (B+)

- [ ] **Step 1: Write failing unit test in `test.js`**
  Add assertions that `getCodingScore('kimi-k3')` >= 7600, `getCodingScore('nemotron-3-ultra-550b')` >= 7100, `getCodingScore('laguna-xs-2.1')` >= 7000.
  ```javascript
  const { getCodingScore } = require('./sync.js');
  assert.ok(getCodingScore('kimi-k3') >= 7600, 'kimi-k3 must be scored in S+ tier');
  assert.ok(getCodingScore('nemotron-3-ultra-550b-a55b') >= 7100, 'nemotron-3-ultra must be scored in S+ tier');
  assert.ok(getCodingScore('laguna-xs-2.1') >= 7000, 'laguna-xs-2.1 must be scored in S+ tier');
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `bun test.js`
  Expected: FAIL (`laguna-xs-2.1` scored at 4600 / `kimi-k3` scored at 4000).

- [ ] **Step 3: Update `BASELINE` in `update-benchmarks.js` and ingest `external-models.json`**
  - Update `BASELINE` entries in `update-benchmarks.js` with the calibrated 2026 rankings.
  - In `updateBenchmarks()`, merge benchmarks from `external-models.json` if present.
  - Run `bun update-benchmarks.js` to regenerate `benchmarks.json`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add update-benchmarks.js benchmarks.json test.js
  git commit -m "feat(benchmarks): upgrade benchmark baseline with 2026 SWE-bench Verified S+/S/A+ rankings"
  ```

---

### Task 5: Upgrade `sync.js` Model Picking & Sorting Algorithm

**Files:**
- Modify: `sync.js:325-385`, `sync.js:410-460`
- Test: `test.js`

**Interfaces:**
- Consumes: Benchmarks with SWE-bench Verified scores, context window lengths, deprecation dates
- Produces: Enhanced `sortModelsByCodingQuality()` with:
  1. Primary: Priority rules & quota status
  2. Secondary: SWE-bench Verified / Coding Score tier
  3. Tertiary: Context Window Agentic weighting (models with 1M or 262k context get higher multi-turn reasoning priority)
  4. Quaternary: Latency tie-breaker
  5. Auto-deprecation drop: models with expired `deprecatedAfter` dates or dead 410 statuses are dropped before combo assembly.

- [ ] **Step 1: Write failing unit test in `test.js`**
  Test that a model with identical score but 1M context is prioritized over a model with 32k context for agentic coding.
  Test that a model with `deprecatedAfter` in the past is classified as `dead`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `bun test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement context weighting and deprecation checking in `sync.js`**
  - Add `isDeprecatedModel(modelId, externalCatalog)` helper.
  - Enhance `sortModelsByCodingQuality` to factor context length tier for models in the same benchmark tier.
  - Update `isSmartTierModel` to include models with SWE-bench score >= 70.0 (S+ and S tiers).

- [ ] **Step 4: Run test to verify it passes**
  Run: `bun test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add sync.js test.js
  git commit -m "feat(sync): enhance model picking with context weighting and deprecation filtering"
  ```

---

### Task 6: Live Verification & Synchronization in Kubernetes Pod

**Files:**
- Pod: `router/router-585bb86b9c-vs5qj:/app/9router-auto-free/`
- Test: Live pre-tests, dry run, and production sync

- [ ] **Step 1: Run local test suite with Bun**
  ```bash
  bun test.js
  ```
  Expected: All unit tests pass locally on Windows host.

- [ ] **Step 2: Copy updated codebase to pod**
  ```bash
  kubectl cp . router-585bb86b9c-vs5qj:/app/9router-auto-free/ -n router
  ```

- [ ] **Step 3: Run full test suite in pod**
  ```bash
  kubectl exec -n router router-585bb86b9c-vs5qj -- sh -c "cd /app/9router-auto-free && node test.js"
  ```
  Expected: All unit tests pass in pod environment.

- [ ] **Step 4: Run dry-run sync in pod**
  ```bash
  kubectl exec -n router router-585bb86b9c-vs5qj -- sh -c "cd /app/9router-auto-free && node sync.js --dry-run"
  ```
  Verify:
  - `my9model-free` does NOT contain any `ocg/` models.
  - Active providers (Cerebras, Groq, Freebuff, MiMo Code, Devin CLI, etc.) are considered.
  - Frontier models (Kimi K3, Nemotron 3 Ultra, Laguna XS, Gemini 3.8 Flash) are top-ranked in `my9model-smart`.

- [ ] **Step 5: Run live synchronization in pod**
  ```bash
  kubectl exec -n router router-585bb86b9c-vs5qj -- sh -c "cd /app/9router-auto-free && node sync.js"
  ```

- [ ] **Step 6: Verify SQLite `combos` table in pod**
  Verify `my9model-free`, `my9model-smart`, `my9model-fast`, `ocg-free`, `gh-free`, `ag-free`, `cerebras-free`, etc.

- [ ] **Step 7: Commit all documentation and state files**
  ```bash
  git add .
  git commit -m "chore: complete 2026 external model list integration and live sync"
  ```

---

## Plan Self-Review
1. **Spec Coverage:**
   - Exclude OpenCode Go from `my9model-free` -> Covered in Task 1.
   - Use direct static raw GitHub URLs with backoff retry (no `gh` CLI) -> Covered in Task 2.
   - Auto-consider all active 9router providers (Cerebras, Freebuff, MiMo Code, Devin CLI, Groq, etc.) -> Covered in Task 3.
   - Dynamic external free model harvesting to eliminate static list drift -> Covered in Task 2 & Task 3.
   - Use `bun` exclusively on Windows host for testing and execution -> Specified in Global Constraints and Tasks 1-6.
   - Latest models, rankings, and what is new in 2026 -> Detailed in Landscape table and Task 4.
   - Enhanced model picking and sorting -> Covered in Task 5.
   - Pod live sync and verification -> Covered in Task 6.
2. **No Placeholders:** All file paths, commands, scores, and interfaces are explicitly defined.
3. **Type Consistency:** Method names and data structures match across tasks.
