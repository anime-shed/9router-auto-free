# SDD ledger — plan: docs/superpowers/plans/2026-10-15-incorporate-free-model-lists-and-benchmarks.md

## Pre-flight Plan Scan
| Task Pair / Task | Interface / Shared Element | Finding | Ruling |
| :--- | :--- | :--- | :--- |
| Task 1 & Task 5 | `sync.js` (assembleCombos) | Task 1 filters `ocg/` and `opencode-go/` from `my9model-*` while keeping `ocg-free`. | Clean — consistent with CONTEXT.md |
| Task 2 & Task 3 | `fetch-external-models.js` -> `providers.js` / `update-benchmarks.js` | Task 2 generates `external-models.json`. Task 3 ingests it for dynamic candidate pools and benchmarks. | Clean — decoupling through file schema |
| Task 3 & Task 4 | `external-models.json` -> `update-benchmarks.js` | Baseline calibration with 2026 SWE-bench Verified rankings | Clean |
| Task 4 & Task 5 | `benchmarks.json` -> `sync.js` | Multi-tier sorting and context window bonus | Clean |
| All Tasks | Testing | Windows host uses Bun (`bun test.js`), Pod uses Node.js (`node test.js`) | Clean |

## Execution Progress
- [x] Task 1: Exclude OpenCode Go from `my9model-*` Super-Combos (commit 354fc4c, review clean)
- [x] Task 2: Build External Free Model Harvester (`fetch-external-models.js`) with Backoff Retry (commit 74f5722, review clean)
- [x] Task 3: Auto-Consider All Active Providers & Dynamic Pool Enrichment (commit 03a0255, review clean)
- [x] Task 4: Upgrade `update-benchmarks.js` & `benchmarks.json` with 2026 Verified S+/S/A+ Rankings (commit 5e16bfc, review clean)
- [x] Task 5: Upgrade `sync.js` Model Picking & Sorting Algorithm (commit 3f0f8f0, review clean)
- [x] Task 6: Live Verification & Synchronization in Kubernetes Pod (pod sync completed, review clean)

## Rulings Made
1. **Ruling: Super-Combo Exclusions for OpenCode Go** — OpenCode Go models (`ocg/`, `opencode-go/`) are excluded from `my9model-free`, `my9model-smart`, `my9model-fast`, and `my9model-cooldown` to avoid polluting the general free pool, while remaining available in their dedicated `ocg-free` combo. (Cost if wrong: OpenCode Go models wouldn't be part of the fallback super-combo, but user specifically mandated this separation).
2. **Ruling: Dynamic Fallback Path for External Models Catalog** — In pod container, paths could resolve either relative to `__dirname` or fallback locations. Added safe resolution so `external-models.json` is reliably ingested across both Windows Bun and Linux Node.js environments.
3. **Ruling: Non-Text and Deprecated Models Filter** — Audio, TTS, speech, and embeddings models along with expired strikethrough/sunset models in catalogs are preemptively filtered out before candidate pool generation. (Cost if wrong: non-coding models omitted from coding combos, which matches repo intent).

