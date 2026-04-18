# Repository Guidelines for AI Agents

## Project Overview

`rs-js` is a high-performance Rust/WASM data engine for JavaScript. It exposes a `RsJs` class (Node.js CJS via `js/index.node.cjs`, browser ESM via `js/index.js`) that loads row data once into WASM linear memory and supports repeated zero-copy queries. Up to 45× faster than native JS for columnar analytics.

---

## Project Structure

```
src/
  lib.rs              #[wasm_bindgen] entrypoints: DataEngine, PreparedQuery
  engine.rs           execute_for_engine() — row-based pipeline (fallback path)
  column_store.rs     ColumnStore — typed arrays + BitSet; columnar fast path
  eval.rs             shared condition evaluator (filter + find)
  types.rs            Operation enum, PipelineResult, Row = IndexMap<String, Value>
  operations/         one file per op: filter, map, reduce, group_by, count, find

js/
  index.node.cjs      JS wrapper (CJS, Node.js) — smart routing + per-op thresholds
  index.js            JS wrapper (ESM, browser/bundler)
  index.d.ts          TypeScript definitions (discriminated unions)
  __tests__/          Jest integration tests

examples/             runnable usage samples (01–08)
benchmark.js          performance comparison vs native JS
pkg-node/             generated WASM (Node.js target) — do not hand-edit
pkg/                  generated WASM (bundler target) — do not hand-edit
pkg-web/              generated WASM (web target) — do not hand-edit
```

---

## Public API (current)

**Core class:** `RsJs` (not `DataEngine` — that is the internal WASM class)

```js
const { RsJs } = require('rs-js');          // Node.js CJS
import { createRsJs } from 'rs-js';         // Browser ESM (async)

const engine = new RsJs(data, options?);
engine.query(operations, options?)           // → PipelineResult
engine.filterIndices(ops, opts?)             // → Uint32Array
engine.filterViewRef(ops, callback, opts?)   // → zero-copy callback
engine.mapRef(ops, callback, opts?)          // → zero-copy callback
engine.filterMapRef(fOps, mOps, callback, opts?) // → zero-copy callback
engine.groupByIndices(field)                 // → { key: Uint32Array }
engine.len()
engine.is_empty()
engine.free()
```

**Operations:** `filter`, `map`, `reduce`, `groupBy`, `count`, `find`

**PipelineResult** is a discriminated union — always check `.type` before `.value`.

---

## Build Commands

```bash
cargo check --target wasm32-unknown-unknown          # type-check only (fast)
wasm-pack build --release --target nodejs --out-dir pkg-node
wasm-pack build --release --target bundler --out-dir pkg
wasm-pack build --release --target web    --out-dir pkg-web
cargo test                                            # Rust unit tests
npm test                                             # Jest integration tests
node benchmark.js                                    # performance benchmark
```

---

## Coding Conventions

**Rust:**
- Always use `Serializer::json_compatible()` when returning `JsValue` — default emits `BigInt` for large integers
- Prefer `ColumnStore` fast paths for numeric ops; add fallback in `engine.rs` only if columnar path is impossible
- `ReduceOp` derives `Clone` — required by `group_by.rs` aggregate loop
- `[profile.test]` overrides `panic = "unwind"` to allow `#[should_panic]` tests
- `Col::F64` uses `f64::NAN` for null; `Col::Bool` uses `255` for null

**JavaScript:**
- `js/index.node.cjs` and `js/index.js` must stay in sync — same logic, different module format
- Per-op thresholds: `_filterThreshold=15k`, `_mapThreshold=MAX_SAFE_INTEGER`, `_groupByThreshold=30k`
- `_mapThreshold=MAX_SAFE_INTEGER` is intentional — mapRef+merge overhead exceeds JS spread at all sizes
- `_queryFilterMap` uses `filterIndices` + compiled JS exprs, not `filterMapRef` (row-object output)
- `compileExpr` eliminates per-row recursive dispatch; fast path for `field OP literal` pattern

**TypeScript:**
- `index.d.ts` must match all exported methods with correct signatures
- `PipelineResult` is a discriminated union — `type` field is the discriminant
- Zero-copy API types: `FilterMapRef`, `FilterSelectionRef`, `MapRefView`

---

## Testing Guidelines

- JS tests live in `js/__tests__/dataEngine.test.js` — 74+ tests, all must pass
- Cover: all ops, zero-copy APIs (filterMapRef, filterViewRef, mapRef), edge cases (empty result, zero rows)
- Match existing test naming: `describe('filterMapRef')`, `test('count matches expected')`
- Rust unit tests: alongside relevant module or in `tests/`

---

## Commit & PR Guidelines

- Conventional Commits: `feat:`, `refactor:`, `chore:`, `fix:`
- Include benchmark output or test results when changing performance-sensitive code
- If changing exported API: update `lib.rs`, `index.node.cjs`, `index.js`, `index.d.ts`, tests, README together
- Do not hand-edit generated `pkg-*` directories
