// storage-adapter.smoke.mjs — S3-5 standalone smoke test.
// ============================================================================
// Exercises the EXACT adapter app/discovery-board.jsx uses (createStorage), with
// injected fake `window`-like objects, asserting:
//   1. Host `window.storage` is preferred, round-trips, and get returns { value }.
//   2. localStorage is used when no host store — and returns the { value } shape
//      the board reads (r?.value), proving old saved discoveries keep loading.
//   3. No window at all -> in-memory fallback (still round-trips within a session).
//   4. Host `window.storage` WINS over localStorage when both are present.
//   5. Missing key -> null (so the board falls back to SAMPLE, not a crash).
//
// Run:  node app/lib/storage-adapter.smoke.mjs
// ============================================================================

import { createStorage } from "./storage-adapter.mjs";

let passed = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok   = (msg) => { passed++; console.log(`  ✓ ${msg}`); };
const assert = (cond, msg) => (cond ? ok(msg) : fail(msg));

const KEY = "serendipity-discoveries-v1";

// ── Fakes ────────────────────────────────────────────────────────────────────
function fakeHostWindow() {
  const store = new Map();
  return {
    storage: {
      async get(k) { return store.has(k) ? { value: store.get(k) } : null; },
      async set(k, v) { store.set(k, v); },
    },
    __store: store,
  };
}
function fakeLocalStorageWindow(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
    },
    __store: store,
  };
}

// ── 1. Host window.storage preferred + round-trips ───────────────────────────
await (async () => {
  const w = fakeHostWindow();
  const s = createStorage(w);
  assert(s.backend === "window.storage", "host store selected when window.storage present");
  await s.set(KEY, JSON.stringify([{ id: "D1" }]));
  const r = await s.get(KEY);
  assert(r && r.value && JSON.parse(r.value)[0].id === "D1", "host store round-trips via { value }");
  assert(w.__store.get(KEY) !== undefined, "host store actually received the write");
})();

// ── 2. localStorage fallback + back-compat load of pre-existing data ──────────
await (async () => {
  // Pre-seed as if an EARLIER build wrote directly to localStorage.
  const seeded = JSON.stringify([{ id: "OLD-1", title: "legacy discovery" }]);
  const w = fakeLocalStorageWindow({ [KEY]: seeded });
  const s = createStorage(w);
  assert(s.backend === "localStorage", "localStorage selected when no host store");
  const r = await s.get(KEY);
  assert(r && r.value && JSON.parse(r.value)[0].id === "OLD-1",
    "old localStorage-saved discoveries still load (back-compat)");
  await s.set(KEY, JSON.stringify([{ id: "NEW-1" }]));
  const r2 = await s.get(KEY);
  assert(JSON.parse(r2.value)[0].id === "NEW-1", "localStorage round-trips new writes");
})();

// ── 3. No window -> in-memory fallback ───────────────────────────────────────
await (async () => {
  const s = createStorage(null);
  assert(s.backend === "memory", "in-memory fallback when no window/store available");
  const empty = await s.get(KEY);
  assert(empty === null, "missing key returns null (board falls back to SAMPLE)");
  await s.set(KEY, "[]");
  const r = await s.get(KEY);
  assert(r && r.value === "[]", "in-memory round-trips within a session");
})();

// ── 4. Host store wins over localStorage when BOTH present ────────────────────
await (async () => {
  const w = { ...fakeHostWindow(), ...fakeLocalStorageWindow() };
  // (spread rebuilds both keys) — ensure both exist:
  const host = fakeHostWindow();
  const local = fakeLocalStorageWindow();
  const both = { storage: host.storage, localStorage: local.localStorage };
  const s = createStorage(both);
  assert(s.backend === "window.storage", "host store takes precedence over localStorage");
})();

// ── 5. Missing key on host store -> null ─────────────────────────────────────
await (async () => {
  const s = createStorage(fakeHostWindow());
  assert((await s.get("nope")) === null, "host store missing key returns null");
})();

console.log(`\nstorage-adapter.smoke: ${passed} checks passed`);
