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
- [ ] Task 1: Exclude OpenCode Go from `my9model-*` Super-Combos
- [ ] Task 2: Build External Free Model Harvester (`fetch-external-models.js`) with Backoff Retry
- [ ] Task 3: Auto-Consider All Active Providers & Dynamic Pool Enrichment
- [ ] Task 4: Upgrade `update-benchmarks.js` & `benchmarks.json` with 2026 Verified S+/S/A+ Rankings
- [ ] Task 5: Upgrade `sync.js` Model Picking & Sorting Algorithm
- [ ] Task 6: Live Verification & Synchronization in Kubernetes Pod
