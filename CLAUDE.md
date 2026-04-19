# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Native unit tests (fast, no WASM runner needed)
cargo test
cargo test <test_name>       # single test

# Type-check for WASM target (faster than full build)
cargo check --target wasm32-unknown-unknown

# WASM builds (requires: rustup target add wasm32-unknown-unknown && cargo install wasm-pack)
wasm-pack build --dev  --target bundler --out-dir pkg        # dev
wasm-pack build --release --target bundler  --out-dir pkg
wasm-pack build --release --target nodejs   --out-dir pkg-node
wasm-pack build --release --target web      --out-dir pkg-web
npm run build:all   # all three targets + strip .gitignore files

# WASM integration tests
wasm-pack test --headless --chrome

# JS integration tests (requires pkg-node build first)
npm test            # Jest — js/__tests__/dataEngine.test.js (74+ tests)

# Benchmark
node benchmark.js
BENCH_SIZES=10000,100000 node benchmark.js

cargo clippy
cargo fmt
```

## Architecture

Rust library compiled to WASM via `wasm-pack`/`wasm-bindgen`. JS calls `engine.query(operations, options?)` → Rust executes a pipeline → returns `{ type, value }` tagged union.

```
js/index.node.cjs    JS RsJs wrapper (CJS, Node.js); smart routing + per-op thresholds
js/index.js          JS RsJs wrapper (ESM, browser/bundler) — must stay in sync with index.node.cjs
js/index.d.ts        TypeScript definitions (discriminated union on PipelineResult)
js/__tests__/        Jest integration tests
src/lib.rs           #[wasm_bindgen] entrypoints: DataEngine (internal WASM class), PreparedQuery
src/engine.rs        execute_for_engine() — row-based pipeline fold (fallback path)
src/column_store.rs  ColumnStore — typed arrays + BitSet; columnar fast path
src/eval.rs          shared condition evaluator (used by row-based filter + find)
src/types.rs         Operation enum, PipelineResult, Row = IndexMap<String, Value>
src/operations/      one file per op: filter, map, reduce, group_by, count, find
pkg-node/ pkg/ pkg-web/  generated WASM output — do not hand-edit
```

**Public API**: `new RsJs(data)` (Node.js CJS) or `createRsJs(data)` (browser ESM, async). The internal WASM class is `DataEngine` — never expose it directly. Data is deserialized into WASM memory once; `.query(ops, opts)` runs without re-serializing. `.free()` must be called to release WASM memory.

**Dual data representation**: `DataEngine::new()` builds both a row store (`Vec<Row>`) and a `ColumnStore` (typed arrays: `Col::F64`, `Col::Bool`, `Col::Str`). Every query chooses a path:
- **Columnar fast path** (`try_columnar` in `column_store.rs`): scalar-returning ops (count, reduce, find, groupBy with aggregates). Operates on typed arrays via `BitSet` masking — zero row allocation.
- **Row-based fallback** (`execute_for_engine` in `engine.rs`): array-returning ops (filter, map, groupBy without aggregates). Uses a `Working` enum to defer cloning until a map op forces materialization.

**JS-side routing** (`js/index.node.cjs`): Before hitting WASM, `RsJs.query()` routes by per-op thresholds tuned from benchmarks:
- Single filter: JS path below `filterThreshold` (default 15,000 rows), else `filterIndices()` + index lookup
- Single map: JS path below `mapThreshold` (default `Number.MAX_SAFE_INTEGER` — intentional, `mapRef`+merge overhead exceeds JS spread at all sizes)
- groupBy without aggregates: JS path below `groupByThreshold` (default 30,000 rows), else `groupByIndices()` returns `{ key: Uint32Array }`
- All other pipelines → `PreparedQuery` (ops parsed once, reused) + `queryPrepared()`
- `smallRowThreshold` option overrides all three thresholds (backwards compatibility)
- `compileExpr` eliminates per-row recursive dispatch; has fast path for `field OP literal` pattern

**Low-level columnar methods** (bypass the row engine entirely):
- `filterIndices(ops, opts)` → `Uint32Array` of matching row indices
- `filterView(ops, opts)` → `{ field: Float64Array | Uint8Array | { codes: Uint16Array, categories: string[] } }` — copies data out of WASM heap
- `filterViewRef(ops, callback, opts)` → calls `callback({ indices: Uint32Array, columns: FilterView })` with zero-copy window views into WASM memory; do not call other WASM methods while views are live
- `mapField(ops, opts)` → `{ field: Float64Array }` for each map transform (computed columns only)
- `mapViewRef(ops, callback, opts)` → calls `callback(MapViewRef)` with zero-copy column views for direct field projections only (no arithmetic)
- `mapComputed(ops, callback, opts)` → calls `callback(MapComputedView)` with materialized computed columns (`Float64Array` for arithmetic, `Array` for template/field)
- `groupByIndices(field)` → `{ groupKey: Uint32Array }` of row indices per group

**Operation model**: `filter` and `map` are intermediate (chainable); `reduce`, `groupBy`, `count`, `find` are terminal (consume data, return immediately). Engine enforces this by position in the pipeline.

**PipelineResult variants**:
- `Array` — filter, map, groupBy without aggregates
- `Number` — reduce, count
- `Object` — groupBy with aggregates (`{ groupKey: { _count, alias: value } }`)
- `Item` — find (single row or null)

## Key serde shapes

Operations use `#[serde(tag = "op")]` — discriminant is the `"op"` field:
```js
{ op: "filter", conditions: [{ field: "age", operator: "gte", value: 18 }] }
{ op: "map", transforms: [{ field: "tax", expr: { type: "arithmetic", op: "*", left: { type: "field", name: "salary" }, right: { type: "literal", value: 0.2 } } }] }
{ op: "reduce", field: "amount", reducer: "sum" }
{ op: "groupBy", field: "country", aggregate: [{ field: "salary", reducer: "avg", alias: "avg_salary" }] }
{ op: "count" }
{ op: "find", conditions: [...] }
```

`groupBy.field` accepts either a string or array of strings (`string_or_vec` custom deserializer in `types.rs`).

`filter.logic` / `find.logic` defaults to `"and"`; set to `"or"` for any-condition matching.

## Column store encoding

- `Col::F64` — numeric fields; `f64::NAN` represents null/missing
- `Col::Bool` — boolean fields; `0`=false, `1`=true, `255`=null
- `Col::Str` — all other fields; categorical encoding: `codes: Vec<u16>` indexes into `categories: Vec<Option<String>>`

`build_col` sniffs the first scan of a field: if any non-null, non-bool, non-number value appears it becomes `Str`. Mixed num/bool also becomes `Str`.

## Coding conventions

- `js/index.node.cjs` and `js/index.js` must stay in sync — same routing logic, different module format (CJS vs ESM)
- When changing the exported API, update `lib.rs`, `index.node.cjs`, `index.js`, `index.d.ts`, tests, and README together
- Prefer `ColumnStore` fast paths for numeric ops; add row-engine fallback in `engine.rs` only if columnar path is impossible
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`; include benchmark output when changing performance-sensitive code

## Critical notes

- Always use `Serializer::json_compatible()` when serialising back to `JsValue` — default in serde-wasm-bindgen 0.6 emits `BigInt` for large integers.
- `ReduceOp` derives `Clone` — required by `group_by.rs` aggregate loop.
- `[profile.test]` overrides `panic = "unwind"` so `#[should_panic]` tests work despite `panic = "abort"` in release.
- `groupByIndices` supports all column types: `Col::Str` uses categorical codes (fast), `Col::F64` buckets by bit-pattern (`to_bits()`, NaN→"null"), `Col::Bool` uses 3 fixed buckets ("false"/"true"/"null").
- `filterViewRef` and `mapViewRef` return zero-copy TypedArray views into WASM linear memory. Any Rust allocation (i.e., calling another WASM method) while the view is held can invalidate the backing memory.
- `try_columnar` returns `None` (falls back to row engine) when the pipeline has ops after a terminal, or when the terminal is a `Map`.
