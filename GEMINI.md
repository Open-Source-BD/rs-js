# GEMINI.md — rs-js Project Context

This file provides context for the `rs-js` project: a high-performance Rust/WASM data engine for JavaScript.

---

## Project Overview

`rs-js` compiles Rust data processing logic to WebAssembly via `wasm-pack`/`wasm-bindgen`. JavaScript calls `new RsJs(data)` to deserialize data once into WASM linear memory, then calls `.query(operations)` or zero-copy APIs many times without re-serializing.

**Performance:** Up to 45× faster than native JS for columnar operations (measured: `mapRef` projection at 500k rows = 45.3× speedup).

**Technologies:** Rust 2024 edition, WebAssembly, `wasm-bindgen`, `serde-wasm-bindgen 0.6`, `wasm-pack`.

---

## Architecture

```
js/index.node.cjs    JS wrapper (CJS, Node.js) — smart routing + per-op thresholds
js/index.js          JS wrapper (ESM, browser/bundler)
js/index.d.ts        Public TypeScript definitions

src/lib.rs           #[wasm_bindgen] entrypoints: DataEngine, PreparedQuery
src/engine.rs        execute_for_engine() — row-based pipeline (fallback)
src/column_store.rs  ColumnStore — typed arrays + BitSet; columnar fast path
src/eval.rs          shared condition evaluator (filter + find)
src/types.rs         Operation enum, PipelineResult, Row = IndexMap<String, Value>
src/operations/      filter.rs, map.rs, reduce.rs, group_by.rs, count.rs, find.rs
```

**Key design:** Every `new RsJs(data)` builds BOTH a row store (`Vec<Row>`) and a `ColumnStore` (typed arrays: `Col::F64`, `Col::Bool`, `Col::Str`). Each query picks the fastest path:
- **Columnar path** — scalar-returning ops (count, reduce, find, groupBy+agg). BitSet masking, zero row allocation.
- **Row-based fallback** — array-returning ops (filter, map, groupBy without agg). Deferred cloning via `Working` enum.
- **JS path** — small datasets where WASM FFI overhead > computation time.

---

## Public API

**Note:** The public class is `RsJs` (in JS). `DataEngine` is the internal WASM-side class exposed by `wasm-bindgen` — do not expose it directly.

```ts
class RsJs {
  constructor(data: Record<string, unknown>[], options?: RsJsOptions)
  query(operations: Operation[], options?: PipelineOptions): PipelineResult
  filterIndices(ops: Operation[], opts?: PipelineOptions): Uint32Array
  filterViewRef(ops: Operation[], callback: (ref: FilterSelectionRef) => unknown, opts?: PipelineOptions): unknown
  mapRef(ops: Operation[], callback: (ref: MapRefView) => unknown, opts?: PipelineOptions): unknown
  filterMapRef(filterOps: Operation[], mapOps: Operation[], callback: (ref: FilterMapRef) => void, opts?: PipelineOptions): void
  groupByIndices(field: string): Record<string, Uint32Array>
  len(): number
  is_empty(): boolean
  free(): void
}

async function createRsJs(data, options?): Promise<RsJs>   // browser/ESM factory
```

---

## Operation Shapes

```js
{ op: 'filter',  conditions: [{ field, operator, value }], logic?: 'and'|'or' }
{ op: 'map',     transforms: [{ field, expr: MapExpr }] }
{ op: 'reduce',  field, reducer: 'sum'|'avg'|'min'|'max'|'first'|'last', alias? }
{ op: 'groupBy', field: string|string[], aggregate?: [{ field, reducer, alias }] }
{ op: 'count',   field? }
{ op: 'find',    conditions: [...], logic? }
```

**Intermediate** (chainable): `filter`, `map`
**Terminal** (end pipeline): `reduce`, `groupBy`, `count`, `find`

---

## PipelineResult

Always a discriminated union — check `.type` before accessing `.value`:

```ts
{ type: 'array',  value: Record<string, unknown>[] }           // filter, map, groupBy (no agg)
{ type: 'number', value: number }                               // reduce, count
{ type: 'object', value: Record<string, Record<string, unknown>> } // groupBy + agg
{ type: 'item',   value: Record<string, unknown> | null }      // find
```

---

## Zero-Copy APIs

- **`filterViewRef`** — callback receives `{ indices: Uint32Array, columns: { [field]: Float64Array | Uint8Array | StrColumnView } }`. Views are windows into WASM memory — valid only inside callback.
- **`mapRef`** — callback receives `{ [field]: Float64Array | ... }`. Field projections = zero-copy subarrays. Arithmetic = new `Float64Array` on JS heap.
- **`filterMapRef`** — combined filter+map. Callback receives `{ count, indices, columns }` where columns are **gathered** (compacted to matched rows). Not sparse like `filterViewRef`.
- **`groupByIndices`** — returns `{ groupKey: Uint32Array }` with no row serialization.

> **Critical:** Do not call other WASM methods while zero-copy views are live — any Rust allocation can invalidate backing memory.

---

## Column Store Encoding

- `Col::F64` — numeric fields; `f64::NAN` = null/missing
- `Col::Bool` — boolean; `0`=false, `1`=true, `255`=null
- `Col::Str` — categorical; `codes: Vec<u16>` indexes into `categories: Vec<Option<String>>`

Type is sniffed on first scan: any non-null, non-bool, non-number value → `Str`. Mixed num/bool → `Str`.

---

## Critical Implementation Notes

- Always use `Serializer::json_compatible()` when serializing back to `JsValue` — default emits `BigInt` for large integers
- `ReduceOp` derives `Clone` — required by `group_by.rs` aggregate loop
- `[profile.test]` overrides `panic = "unwind"` so `#[should_panic]` tests work despite `panic = "abort"` in release
- `_mapThreshold = MAX_SAFE_INTEGER` is intentional — mapRef+merge overhead > JS spread at all dataset sizes for row-object output
- `compileExpr` in JS wrapper eliminates per-row recursive dispatch; `field OP literal` fast path matches V8-JIT performance
- `filterMapRef` Phase 1/2/3 pattern: Phase 1 = all Rust allocations, Phase 2 = capture memory buffer, Phase 3 = build subarray views (no more Rust allocations after Phase 2)

---

## Build & Test

```bash
# Type-check (fast, no WASM binary)
cargo check --target wasm32-unknown-unknown

# Build Node.js target
wasm-pack build --release --target nodejs --out-dir pkg-node

# Tests
cargo test                     # Rust unit tests
npm test                       # Jest integration tests (requires pkg-node)

# Benchmark
node benchmark.js
BENCH_SIZES=100000 node benchmark.js

# Examples
node examples/08_filter_map_ref.js    # zero-copy filterMapRef demo
```
