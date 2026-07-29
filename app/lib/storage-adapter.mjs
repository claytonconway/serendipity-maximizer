// storage-adapter.mjs — S3-5 loadability: nullable-safe persistence adapter.
// ============================================================================
// The discovery board persists via an async key/value contract:
//   const r = await storage.get(KEY);   // -> { value } | null
//   await storage.set(KEY, string);
//
// Some artifact hosts inject `window.storage` (async, host-managed). Others don't
// — a plain browser only has synchronous `localStorage`. Historically the board
// hard-referenced `window.storage`, so it simply failed to persist on any host
// without it. This adapter resolves ONE backing store at load time, preferring
// the host store, then localStorage, then an in-memory Map (last-resort, so the
// board still runs read/write within a session even with no persistence at all).
//
// Back-compat: localStorage saved discoveries (the "serendipity-discoveries-v1"
// key written by earlier builds) keep loading unchanged — getItem returns the
// stored JSON string, which we wrap as { value } to match the host contract.
//
// Additive + zero-dep + portable: no imports, no browser assumptions at module
// scope (the window lookup is guarded), so it is safe to inline into the bundled
// artifact AND to unit-test under Node with an injected fake window.

/**
 * Resolve a storage adapter with the shape { get(key), set(key, value) }.
 * @param {object} [win] window-like object to probe. Defaults to the ambient
 *   `window` when present, else undefined (Node / SSR).
 * @returns {{ get:(k:string)=>Promise<{value:string}|null>,
 *             set:(k:string,v:string)=>Promise<void>, backend:string }}
 */
export function createStorage(win) {
  const w = win !== undefined
    ? win
    : (typeof window !== "undefined" ? window : undefined);

  // 1. Host-provided async store (preferred). Must expose get + set.
  const host = w && w.storage;
  if (host && typeof host.get === "function" && typeof host.set === "function") {
    // Wrap so `backend` is observable and both calls are await-safe even if the
    // host implemented them synchronously.
    return {
      backend: "window.storage",
      async get(key) { return await host.get(key); },
      async set(key, value) { return await host.set(key, value); },
    };
  }

  // 2. Synchronous localStorage — adapt to the async { value } contract.
  const ls = w && w.localStorage;
  if (ls && typeof ls.getItem === "function" && typeof ls.setItem === "function") {
    return {
      backend: "localStorage",
      async get(key) {
        const value = ls.getItem(key);
        return value == null ? null : { value };
      },
      async set(key, value) { ls.setItem(key, value); },
    };
  }

  // 3. In-memory fallback — no persistence across reloads, but the board still
  //    functions within a session (and Node smokes run) instead of throwing.
  const mem = new Map();
  return {
    backend: "memory",
    async get(key) { return mem.has(key) ? { value: mem.get(key) } : null; },
    async set(key, value) { mem.set(key, String(value)); },
  };
}
