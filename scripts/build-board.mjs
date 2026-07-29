#!/usr/bin/env node
// build-board.mjs — S3-5 loadability: zero-dependency, offline board bundler.
// ============================================================================
// WHY: `app/discovery-board.jsx` is meant to be opened "as a React artifact".
// A single-file artifact host transpiles JSX and resolves the external `react`
// import, but it may NOT resolve the board's sibling `./lib/*.mjs` ESM imports.
// This script inlines the entry's relative-import graph into ONE self-contained
// artifact, `app/discovery-board.bundled.jsx`, that such a host can open directly.
//
// APPROACH: a tiny CommonJS-style module registry. Each inlined library module
// is wrapped in a factory `(module, exports, __sm_require)` so every module keeps
// its OWN scope. That isolation is REQUIRED here: steering-loop.mjs and
// semantic-convergence.mjs both export `ideaDistance` and `gDist`, so naive flat
// concatenation would collide. The registry evaluates each module lazily on first
// require and caches its exports (handling any future cycles the CJS way).
//
// Only the entry's NON-relative import (`react`) is preserved as a real top-level
// ESM import; the JSX entry body (and its `export const` / `export default`) is
// emitted verbatim except that its relative `./lib/*` imports become __sm_require
// calls. SOURCE is untouched (relative ESM preserved) — this only EMITS a file.
//
// ZERO-DEP: Node built-ins only (fs, path, url, vm). No network, no npm installs.
// The build SELF-VALIDATES: it asserts no relative import remains unresolved, and
// it EXECUTES the inlined library graph in a `vm` sandbox to prove it evaluates
// (the lib closure is pure, portable JS with no browser globals). It exits
// non-zero on any failure, so a green run is meaningful.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ENTRY = resolve(ROOT, "app/discovery-board.jsx");
const OUT = resolve(ROOT, "app/discovery-board.bundled.jsx");

// Canonical module id = basename without a JS-ish extension. Both `./lib/x.mjs`
// (from the entry) and `./x.mjs` (between lib modules) resolve to the same id `x`.
const idOf = (spec) => basename(spec).replace(/\.(mjs|jsx|js)$/, "");
// Resolve a relative specifier to an absolute path, on disk, from a base file.
const pathOf = (spec, fromFile) => resolve(dirname(fromFile), spec);

const isRelative = (spec) => spec.startsWith("./") || spec.startsWith("../");

// One regex for every static import (single- or multi-line): captures the import
// clause and the specifier. Anchored at line-start (`^…m`) so it matches only real
// import DECLARATIONS — never the words "import"/"from" appearing inside prose
// comments (import statements always begin a line; comment lines begin with //).
// `[\s\S]*?` lets a multi-line clause span newlines up to the first `from`.
const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;

// Turn a named import clause `{ a, b as c }` into a destructuring pattern
// `{ a, b: c }` suitable for `const { … } = __sm_require(id)`.
function clauseToDestructure(clause) {
  const inner = clause.trim().replace(/^\{|\}$/g, "").trim();
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/(\S+)\s+as\s+(\S+)/, "$1: $2"))
    .join(", ");
}

// Rewrite a module body: relative imports -> __sm_require; `export` -> exports.*.
// Returns { code, deps:string[] (absolute paths) }.
function transformModule(src, fromFile) {
  const deps = [];
  let code = src.replace(IMPORT_RE, (m, clause, spec) => {
    if (!isRelative(spec)) return m; // leave e.g. bare specifiers alone
    deps.push(pathOf(spec, fromFile));
    const id = idOf(spec);
    if (clause.trim().startsWith("{")) {
      return `const { ${clauseToDestructure(clause)} } = __sm_require(${JSON.stringify(id)});`;
    }
    // Default/namespace import (not used in this repo) — handled defensively.
    const name = clause.trim().replace(/^\*\s+as\s+/, "");
    return `const ${name} = __sm_require(${JSON.stringify(id)}).default;`;
  });

  const names = new Set();
  // export { a, b as c };  (re-export list without `from`)
  code = code.replace(/^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (m, list) =>
    list
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => {
        const as = n.match(/(\S+)\s+as\s+(\S+)/);
        return as
          ? `exports[${JSON.stringify(as[2])}] = ${as[1]};`
          : `exports[${JSON.stringify(n)}] = ${n};`;
      })
      .join(" ")
  );
  // export default EXPR
  code = code.replace(/^[ \t]*export\s+default\s+/gm, "exports.default = ");
  // export const|let|var NAME
  code = code.replace(/^[ \t]*export\s+(const|let|var)\s+([A-Za-z0-9_$]+)/gm, (m, kw, n) => {
    names.add(n);
    return `${kw} ${n}`;
  });
  // export [async] function NAME
  code = code.replace(/^[ \t]*export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/gm, (m, a, n) => {
    names.add(n);
    return `${a || ""}function ${n}`;
  });
  // export class NAME
  code = code.replace(/^[ \t]*export\s+class\s+([A-Za-z0-9_$]+)/gm, (m, n) => {
    names.add(n);
    return `class ${n}`;
  });
  if (names.size) {
    code += "\n" + [...names].map((n) => `exports[${JSON.stringify(n)}] = ${n};`).join("\n") + "\n";
  }
  return { code, deps };
}

// Rewrite the JSX ENTRY: hoist its non-relative imports (react) to the top,
// convert its relative lib imports to __sm_require, keep everything else verbatim
// (including its own `export const` / `export default`, which stay valid ESM).
function transformEntry(src) {
  const externals = [];
  const deps = [];
  const body = src.replace(IMPORT_RE, (m, clause, spec) => {
    if (!isRelative(spec)) {
      externals.push(m.endsWith(";") ? m : m + ";");
      return "";
    }
    deps.push(pathOf(spec, ENTRY));
    const id = idOf(spec);
    if (clause.trim().startsWith("{")) {
      return `const { ${clauseToDestructure(clause)} } = __sm_require(${JSON.stringify(id)});`;
    }
    const name = clause.trim().replace(/^\*\s+as\s+/, "");
    return `const ${name} = __sm_require(${JSON.stringify(id)}).default;`;
  });
  return { externals, body, deps };
}

// --- Walk the graph from the entry, collecting every reachable lib module. ---
const entrySrc = readFileSync(ENTRY, "utf8");
const entry = transformEntry(entrySrc);

const modules = new Map(); // id -> { id, code, path }
const seen = new Set();
const queue = [...entry.deps];
while (queue.length) {
  const abs = queue.shift();
  if (seen.has(abs)) continue;
  seen.add(abs);
  const src = readFileSync(abs, "utf8");
  const { code, deps } = transformModule(src, abs);
  modules.set(idOf(abs), { id: idOf(abs), code, path: abs });
  for (const d of deps) if (!seen.has(d)) queue.push(d);
}

// --- Assemble the runtime + factory registry (pure JS, no JSX). ---
const RUNTIME = `// ==== bundled module registry (generated by scripts/build-board.mjs) ====
// Do not edit by hand. Regenerate with: node scripts/build-board.mjs
const __sm_modules = {};
const __sm_cache = {};
function __sm_require(id) {
  if (id in __sm_cache) return __sm_cache[id];
  const factory = __sm_modules[id];
  if (!factory) throw new Error("Bundled module not found: " + id);
  const module = { exports: {} };
  __sm_cache[id] = module.exports; // seed before running (cycle-safe)
  factory(module, module.exports, __sm_require);
  __sm_cache[id] = module.exports;
  return module.exports;
}`;

const registry = [...modules.values()]
  .map(
    (m) =>
      `__sm_modules[${JSON.stringify(m.id)}] = function (module, exports, __sm_require) {\n${m.code}\n};`
  )
  .join("\n\n");

const runtimeAndModules = `${RUNTIME}\n\n${registry}\n`;

const banner = `// ============================================================================
// GENERATED — DO NOT EDIT. Self-contained bundle of app/discovery-board.jsx and
// its ./lib/*.mjs graph, produced by scripts/build-board.mjs for single-file
// React-artifact hosts that cannot resolve sibling ESM imports.
// Source of truth stays in app/discovery-board.jsx + app/lib/*.mjs (relative ESM).
// Regenerate: node scripts/build-board.mjs
// Inlined modules: ${[...modules.keys()].sort().join(", ")}
// ============================================================================
`;

const output =
  banner +
  entry.externals.join("\n") +
  "\n\n" +
  runtimeAndModules +
  "\n" +
  entry.body.replace(/^\s+/, "") +
  "\n";

// --- Self-validation #1: no unresolved relative import survived. ---
const leftover = output.match(/from\s+["']\.\.?\//g) || [];
if (leftover.length) {
  console.error(`✗ ${leftover.length} unresolved relative import(s) remain in the bundle.`);
  process.exit(1);
}

// --- Self-validation #2: every __sm_require id is registered. ---
const required = [...output.matchAll(/__sm_require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
const missing = required.filter((id) => !modules.has(id));
if (missing.length) {
  console.error(`✗ Missing bundled modules for: ${[...new Set(missing)].join(", ")}`);
  process.exit(1);
}

// --- Self-validation #3: execute the inlined lib graph in a vm sandbox. ---
// The lib closure is pure/portable JS (no browser globals), so we can actually
// EVALUATE it — proving the inlined graph resolves and runs, not just parses.
try {
  const sandbox = { console, Math, Object, Array, JSON, Number, String, Boolean, Map, Set, Symbol, Date };
  const probe = `${runtimeAndModules}\nglobalThis.__sm_probe = (id) => __sm_require(id);`;
  vm.runInNewContext(probe, sandbox, { filename: "board-bundle-modules.js" });
  for (const id of modules.keys()) sandbox.__sm_probe(id); // force-evaluate each
} catch (e) {
  console.error("✗ Inlined module graph failed to evaluate in vm sandbox:");
  console.error("  " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n  ") : e));
  process.exit(1);
}

writeFileSync(OUT, output, "utf8");
console.log(`✓ Wrote ${OUT.replace(ROOT + "/", "")} (${output.length} bytes)`);
console.log(`✓ Inlined ${modules.size} modules: ${[...modules.keys()].sort().join(", ")}`);
console.log(`✓ 0 unresolved relative imports; ${new Set(required).size} require id(s) all registered`);
console.log(`✓ Inlined lib graph evaluated in vm sandbox`);
console.log(`✓ External imports preserved at top: ${entry.externals.length} (react)`);
