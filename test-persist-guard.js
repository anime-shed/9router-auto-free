/*
 * Ponytail self-check for persistCombos empty-overwrite guard.
 * Verifies the fix for: scheduled sync running in a degraded environment
 * (empty discovery) must NOT blank a previously-populated combo.
 *
 * Runs standalone against a throwaway SQLite DB (no 9router, no network).
 *   node test-persist-guard.js
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Point storage at an isolated temp DB BEFORE requiring it (DB_PATH is
// captured at module load). Also kill the router URL so the API-client
// branch is a no-op and only the SQLite path runs.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '9r-persist-'));
const dbPath = path.join(tmpDir, 'data.sqlite');
process.env.NINEROUTER_DB_PATH = dbPath;
process.env.NINEROUTER_URL = 'http://127.0.0.1:1'; // unreachable -> client branch fails silently

const storage = require('./storage.js');

// Create the 9router `combos` schema the real DB already has, using the
// same driver storage.js uses.
function initSchema() {
  const Database = storage.getDbClass();
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS combos (
    id TEXT PRIMARY KEY,
    name TEXT,
    kind TEXT,
    models TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`);
  db.close();
}

async function run() {
  initSchema();

  // 1. Create the combos table + seed a populated combo via persistCombos itself.
  const seeded = new Map([['my9model-free', ['oa/model-a', 'oa/model-b']]]);
  await storage.persistCombos(seeded);

  let stored = storage.readCurrentComboModels('my9model-free');
  assert.deepStrictEqual(stored, ['oa/model-a', 'oa/model-b'], 'seed: combo should be populated');

  // 2. Degraded sync result: empty list for the already-populated combo.
  //    Guard MUST preserve the existing models.
  await storage.persistCombos(new Map([['my9model-free', []]]));
  stored = storage.readCurrentComboModels('my9model-free');
  assert.deepStrictEqual(
    stored,
    ['oa/model-a', 'oa/model-b'],
    'guard: empty new list must NOT overwrite a populated combo'
  );

  // 3. A real, non-empty update still overwrites normally.
  await storage.persistCombos(new Map([['my9model-free', ['oa/model-c']]]));
  stored = storage.readCurrentComboModels('my9model-free');
  assert.deepStrictEqual(stored, ['oa/model-c'], 'non-empty update must overwrite');

  // 4. Empty list for a combo that doesn't exist yet is a no-op (no crash,
  //    nothing created) — existing is empty, so guard leaves map empty.
  await storage.persistCombos(new Map([['brand-new-combo', []]]));
  assert.deepStrictEqual(
    storage.readCurrentComboModels('brand-new-combo'),
    [],
    'empty new combo stays absent/empty'
  );

  console.log('[\u2713] persistCombos empty-overwrite guard: all checks passed');
}

run()
  .then(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  })
  .catch(err => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    console.error('[X] persist-guard check failed:', err.message);
    process.exit(1);
  });
