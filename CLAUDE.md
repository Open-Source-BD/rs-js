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

Rust library compiled to WASM via `wasm-pack`/`wasm-bindgen`. JS calls `process(data, operations, options?)` → Rust executes a pipeline → returns `{ type, value }` tagged union.

```
js/index.js          thin ESM wrapper, lazy WASM init
js/index.node.js     CJS wrapper for Node.js (initSync)
js/index.d.ts        TypeScript definitions (discriminated union on PipelineResult)
src/lib.rs           #[wasm_bindgen] entrypoint → process_raw()
src/engine.rs        Pipeline struct — folds ops over dataset
src/eval.rs          shared condition evaluator (used by filter + find)
src/types.rs         Operation enum, PipelineResult, Row = IndexMap<String, Value>
src/operations/      one file per op: filter, map, reduce, group_by, count, find
```

**Data flow**: JS Array → `serde_wasm_bindgen` (no JSON roundtrip) → `Vec<IndexMap<String, Value>>` → pipeline fold → `PipelineResult` enum → `Serializer::json_compatible()` → JS.

**Operation model**: `filter` and `map` are intermediate (chainable); `reduce`, `groupBy`, `count`, `find` are terminal (consume data, return immediately). Engine enforces this by position in the pipeline.

**PipelineResult variants**:
- `Array` — filter, map, groupBy without aggregates
- `Number` — reduce, count
- `Object` — groupBy with aggregates (`{ groupKey: { _count, alias: value } }`)
- `Item` — find (single row or null)

## Key serde shapes

Operations use `#[serde(tag = "op")]` — discriminant is the `"op"` field on the same object:
```js
{ op: "filter", conditions: [{ field: "age", operator: "gte", value: 18 }] }
{ op: "reduce", field: "amount", reducer: "sum" }
{ op: "groupBy", field: "country", aggregate: [{ field: "salary", reducer: "avg", alias: "avg_salary" }] }
```

`groupBy.field` accepts either a string or array of strings (`string_or_vec` custom deserializer in `types.rs`).

## Critical notes

- Always use `Serializer::json_compatible()` when serialising back to `JsValue` — default in serde-wasm-bindgen 0.6 emits `BigInt` for large integers.
- `ReduceOp` derives `Clone` — required by `group_by.rs` aggregate loop.
- `[profile.test]` overrides `panic = "unwind"` so `#[should_panic]` tests work despite `panic = "abort"` in release.
