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

# WASM integration tests
wasm-pack test --headless --chrome

cargo clippy
cargo fmt
```

## Architecture

Rust library compiled to WASM via `wasm-pack`/`wasm-bindgen`. JS calls `engine.query(operations, options?)` → Rust executes a pipeline → returns `{ type, value }` tagged union.

```
js/index.js          JS DataEngine wrapper with smart routing + lazy WASM init
js/index.d.ts        TypeScript definitions (discriminated union on PipelineResult)
src/lib.rs           #[wasm_bindgen] entrypoints: DataEngine, PreparedQuery
src/engine.rs        execute_on_slice() — row-based pipeline fold (fallback path)
src/column_store.rs  ColumnStore — typed arrays + BitSet; columnar fast path
src/eval.rs          shared condition evaluator (used by row-based filter + find)
src/types.rs         Operation enum, PipelineResult, Row = IndexMap<String, Value>
src/operations/      one file per op: filter, map, reduce, group_by, count, find
```

**Primary API**: `createEngine(data)` → `DataEngine`. Data is deserialized into WASM memory once; `.query(ops, opts)` runs without re-serializing the dataset. `.free()` must be called to release WASM memory.

**Dual data representation**: `DataEngine::new()` builds both a row store (`Vec<Row>`) and a `ColumnStore` (typed arrays: `Col::F64`, `Col::Bool`, `Col::Str`). Every query chooses a path:
- **Columnar fast path** (`try_columnar` in `column_store.rs`): scalar-returning ops (count, reduce, find, groupBy with aggregates). Operates on typed arrays via `BitSet` masking — zero row allocation.
- **Row-based fallback** (`execute_on_slice` in `engine.rs`): array-returning ops (filter, map, groupBy without aggregates). Uses a `Working` enum to defer cloning until a map op forces materialization.

**JS-side routing** (in `js/index.js`): Before hitting WASM, `DataEngine.query()` applies a `smallRowThreshold` (default 2000) check:
- Single filter, small data → pure JS evaluation
- Single filter, large data → `filterIndices()` WASM call, then JS index lookup
- Single map, large data → `mapField()` returns `Float64Array` columns; JS merges with original rows
- groupBy without aggregates → `groupByIndices()` returns `{ key: Uint32Array }`
- All other pipelines → `PreparedQuery` (ops parsed once, reused) + `queryPrepared()`

**Low-level columnar methods** (bypass the row engine entirely):
- `filterIndices(ops, opts)` → `Uint32Array` of matching row indices
- `filterView(ops, opts)` → `{ field: Float64Array | Uint8Array | { codes: Uint16Array, categories: string[] } }`
- `mapField(ops, opts)` → `{ field: Float64Array }` for each map transform
- `groupByIndices(field)` → `{ groupKey: Uint32Array }`

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

## Critical notes

- Always use `Serializer::json_compatible()` when serialising back to `JsValue` — default in serde-wasm-bindgen 0.6 emits `BigInt` for large integers.
- `ReduceOp` derives `Clone` — required by `group_by.rs` aggregate loop.
- `[profile.test]` overrides `panic = "unwind"` so `#[should_panic]` tests work despite `panic = "abort"` in release.
- `groupByIndices` only works on `Col::Str` columns; returns empty for numeric/bool group keys.
- `try_columnar` returns `None` (falls back to row engine) when the pipeline has ops after a terminal, or when the terminal is a `Map`.
