# rs-js

**High-performance Rust/WASM data engine for JavaScript.** Deserialize once, query many times — up to **45× faster** than native JS for columnar analytics.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![WASM](https://img.shields.io/badge/powered%20by-WebAssembly-654ff0.svg)](https://webassembly.org)

---

## Why rs-js?

JavaScript's core bottleneck for large datasets is **V8 object creation** — spreading `{...row}` for 100k rows costs ~45 ms regardless of how fast your computation is. rs-js bypasses this entirely:

- **Columnar storage** — data lives in typed arrays in WASM linear memory, not JS objects
- **BitSet filtering** — filter 100k rows in 0.68 ms vs 1.08 ms in JS
- **Zero-copy callbacks** — `filterMapRef`, `filterViewRef`, `mapRef` return typed array views directly into WASM memory with no serialization
- **Smart routing** — per-operation thresholds automatically pick JS or WASM path based on dataset size

---

## Performance

Measured on macOS, Node.js, 5-run average. Benchmarked with [`benchmark.js`](./benchmark.js).

### 100,000 rows

| Operation                         | Native JS | rs-js    | Speedup   |
| --------------------------------- | --------- | -------- | --------- |
| `filter` (age ≥ 18)               | 1.08 ms   | 0.68 ms  | **1.6×**  |
| `reduce` (sum salaries)           | 2.30 ms   | 0.30 ms  | **7.7×**  |
| `count` (age ≥ 18)                | 1.07 ms   | 0.19 ms  | **5.6×**  |
| `groupBy + avg` (by country)      | 0.77 ms   | 0.29 ms  | **2.6×**  |
| `pipeline` (filter → groupBy+avg) | 1.68 ms   | 0.65 ms  | **2.6×**  |
| `mapRef` (salary × 0.1)           | 45.47 ms  | 5.93 ms  | **7.7×**  |
| `filterMapRef` (columnar)         | 43.33 ms  | 14.29 ms | **3.0×**  |
| `filterViewRef` (zero-copy)       | 16.13 ms  | 7.02 ms  | **2.3×**  |
| `mapRef` (projection)             | 0.27 ms   | 0.01 ms  | **23.7×** |
| `groupByIndices` (by dept)        | 1.27 ms   | 0.18 ms  | **7.0×**  |

### 500,000 rows

| Operation                   | Native JS | rs-js    | Speedup   |
| --------------------------- | --------- | -------- | --------- |
| `reduce` (sum)              | 9.56 ms   | 1.42 ms  | **6.7×**  |
| `count`                     | 7.01 ms   | 0.95 ms  | **7.4×**  |
| `mapRef` (projection)       | 1.49 ms   | 0.03 ms  | **45.3×** |
| `filterMapRef` (columnar)   | 243.52 ms | 65.18 ms | **3.7×**  |
| `filterViewRef` (zero-copy) | 105.13 ms | 24.44 ms | **4.3×**  |

> **Note:** Row-object operations (`map`, `pipeline filter→map`) are bounded by V8's spread cost (~300 ms/500k) regardless of computation speed. Use zero-copy APIs (`filterMapRef`, `mapRef`) when you need maximum throughput.

---

## Install

```sh
npm i @shaon07/rs-js
```

Requires a WASM build in `pkg-node/`. If building from source:

```sh
# Install dependencies (one-time)
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Build
npm run build
```

---

## Quick Start

### Node.js (CommonJS)

```js
const { RsJs } = require("rs-js");

const users = [
  {
    id: 1,
    name: "Alice",
    age: 32,
    salary: 85000,
    department: "engineering",
    active: true,
  },
  {
    id: 2,
    name: "Bob",
    age: 24,
    salary: 62000,
    department: "marketing",
    active: false,
  },
  {
    id: 3,
    name: "Carol",
    age: 41,
    salary: 97000,
    department: "engineering",
    active: true,
  },
];

// Deserialize once into WASM memory
const engine = new RsJs(users);

// Query many times — no re-serialization
const result = engine.query([
  {
    op: "filter",
    conditions: [{ field: "active", operator: "eq", value: true }],
  },
  {
    op: "groupBy",
    field: "department",
    aggregate: [{ field: "salary", reducer: "avg", alias: "avg_salary" }],
  },
]);
// => { type: 'object', value: { engineering: { _count: 2, avg_salary: 91000 } } }

engine.free(); // always release WASM memory
```

### Browser / ESM

```js
import { createRsJs } from "rs-js";

const data = await fetch("/api/users").then((r) => r.json());
const engine = await createRsJs(data); // async: initializes WASM module first

const result = engine.query([
  { op: "filter", conditions: [{ field: "age", operator: "gte", value: 18 }] },
]);

engine.free();
```

---

## API Reference

### Constructor

```ts
new RsJs(data: Record<string, unknown>[], options?: RsJsOptions): RsJs
createRsJs(data: Record<string, unknown>[], options?: RsJsOptions): Promise<RsJs>
```

| Option              | Type     | Default            | Description                    |
| ------------------- | -------- | ------------------ | ------------------------------ |
| `filterThreshold`   | `number` | `15_000`           | JS path below this row count   |
| `mapThreshold`      | `number` | `MAX_SAFE_INTEGER` | JS path below this row count   |
| `groupByThreshold`  | `number` | `30_000`           | JS path below this row count   |
| `smallRowThreshold` | `number` | —                  | Overrides all three thresholds |

---

### `engine.query(operations, options?)`

Main pipeline entry point. Operations execute left-to-right. Returns a discriminated union:

```ts
type PipelineResult =
  | { type: "array"; value: Record<string, unknown>[] } // filter, map, groupBy (no agg)
  | { type: "number"; value: number } // reduce, count
  | { type: "object"; value: Record<string, Record<string, unknown>> } // groupBy + agg
  | { type: "item"; value: Record<string, unknown> | null }; // find
```

**Always check `result.type` before accessing `result.value`.**

---

## Operations

### `filter`

```js
{ op: 'filter', conditions: Condition[], logic?: 'and' | 'or' }
```

Filters rows by conditions. Default logic is `and`. Supports 13 operators:

| Operator                             | Description           |
| ------------------------------------ | --------------------- |
| `eq`, `ne`                           | equality / inequality |
| `gt`, `gte`, `lt`, `lte`             | numeric comparison    |
| `contains`, `startsWith`, `endsWith` | string matching       |
| `in`, `notIn`                        | set membership        |
| `isNull`, `isNotNull`                | null check            |

```js
// AND (default) — all conditions must match
engine.query([
  {
    op: "filter",
    conditions: [
      { field: "age", operator: "gte", value: 18 },
      { field: "department", operator: "in", value: ["engineering", "design"] },
    ],
  },
]);

// OR — any condition matches
engine.query([
  {
    op: "filter",
    logic: "or",
    conditions: [
      { field: "salary", operator: "gte", value: 100000 },
      { field: "active", operator: "eq", value: true },
    ],
  },
]);
```

---

### `map`

```js
{ op: 'map', transforms: Array<{ field: string, expr: MapExpr }> }
```

Computes new or overwritten fields. Supports four expression types:

```js
engine.query([
  {
    op: "map",
    transforms: [
      // arithmetic: field * literal
      {
        field: "bonus",
        expr: {
          type: "arithmetic",
          op: "*",
          left: { type: "field", name: "salary" },
          right: { type: "literal", value: 0.1 },
        },
      },

      // string template: {fieldName} placeholders
      {
        field: "email",
        expr: { type: "template", template: "{name}@company.com" },
      },

      // field projection
      { field: "salary_copy", expr: { type: "field", name: "salary" } },

      // literal
      { field: "version", expr: { type: "literal", value: 2 } },
    ],
  },
]);
```

---

### `reduce`

```js
{ op: 'reduce', field: string, reducer: 'sum'|'avg'|'min'|'max'|'first'|'last', alias?: string }
```

Terminal. Aggregates a numeric field.

```js
engine.query([
  {
    op: "filter",
    conditions: [{ field: "active", operator: "eq", value: true }],
  },
  { op: "reduce", field: "salary", reducer: "sum" },
]);
// => { type: 'number', value: 48302000 }
```

---

### `groupBy`

```js
{ op: 'groupBy', field: string | string[], aggregate?: ReduceOpInline[] }
```

Terminal. Groups by one or more fields.

- **Without** `aggregate` → `{ type: 'array', value: [{ _group, _count, rows }] }`
- **With** `aggregate` → `{ type: 'object', value: { groupKey: { _count, ...aliases } } }`

```js
// With aggregates
engine.query([
  {
    op: "groupBy",
    field: "department",
    aggregate: [
      { field: "salary", reducer: "avg", alias: "avg_salary" },
      { field: "salary", reducer: "max", alias: "max_salary" },
    ],
  },
]);
// => { type: 'object', value: {
//   engineering: { _count: 420, avg_salary: 91200, max_salary: 149000 },
// }}

// Multi-field groupBy — keys joined with '||'
engine.query([
  {
    op: "groupBy",
    field: ["department", "country"],
    aggregate: [{ field: "salary", reducer: "avg", alias: "avg_salary" }],
  },
]);
// => { 'engineering||US': { _count: 120, avg_salary: 94000 }, ... }
```

---

### `count`

```js
{ op: 'count', field?: string }
```

Terminal. Without `field`: counts all rows. With `field`: counts truthy values.

```js
engine.query([
  { op: "filter", conditions: [{ field: "age", operator: "gte", value: 18 }] },
  { op: "count" },
]);
// => { type: 'number', value: 9600 }
```

---

### `find`

```js
{ op: 'find', conditions: Condition[], logic?: 'and' | 'or' }
```

Terminal. Returns the first matching row or null.

```js
engine.query([
  { op: "find", conditions: [{ field: "id", operator: "eq", value: 42 }] },
]);
// => { type: 'item', value: { id: 42, name: 'Carol', ... } | null }
```

---

## Zero-Copy APIs

These bypass row-object creation entirely. Up to **45× faster** than `query()` for analytics workloads.

### `filterIndices(operations, options?)`

Returns matching row indices as `Uint32Array`. No row data deserialized.

```js
const indices = engine.filterIndices([
  {
    op: "filter",
    conditions: [{ field: "active", operator: "eq", value: true }],
  },
]);
// => Uint32Array [0, 2, 4, ...]

// Access original JS objects by index
for (const idx of indices) {
  console.log(data[idx].salary);
}
```

---

### `filterViewRef(operations, callback, options?)`

Zero-copy columnar filter. Column views are typed-array windows into WASM memory — valid **only inside the callback**.

```js
engine.filterViewRef(
  [
    {
      op: "filter",
      conditions: [{ field: "age", operator: "gte", value: 18 }],
    },
  ],
  (ref) => {
    // ref.indices — Uint32Array of matched row indices
    // ref.columns.salary — Float64Array (numeric)
    // ref.columns.active — Uint8Array (bool: 0/1)
    // ref.columns.department — { codes: Uint16Array, categories: string[] }

    let total = 0;
    for (let i = 0; i < ref.indices.length; i++) total += ref.columns.salary[i];
    return total; // => 48302000
  },
);
```

> **Warning:** Do not call other WASM methods while views are live. Any Rust allocation invalidates the backing memory.

---

### `mapRef(operations, callback, options?)`

Zero-copy map returning computed column arrays.

- Field projections → zero-copy `TypedArray` subarray (stable until `free()`)
- Arithmetic → new `Float64Array` on JS heap
- Templates → `string[]`

```js
// ~8x faster than query() for numeric transforms
let total = 0;
engine.mapRef(
  [
    {
      op: "map",
      transforms: [
        {
          field: "bonus",
          expr: {
            type: "arithmetic",
            op: "*",
            left: { type: "field", name: "salary" },
            right: { type: "literal", value: 0.1 },
          },
        },
      ],
    },
  ],
  (ref) => {
    for (let i = 0; i < ref.bonus.length; i++) total += ref.bonus[i];
  },
);
```

---

### `filterMapRef(filterOps, mapOps, callback, options?)`

Combined filter + map → gathered typed-array columns. All in Rust, zero row objects created. **5–18× faster** than `query()`.

Callback receives `FilterMapRef`:

- `ref.count` — matched row count
- `ref.indices` — `Uint32Array` of original row indices
- `ref.columns` — all original + computed columns **gathered to matched rows**
  - Numeric fields → `Float64Array`
  - Boolean fields → `Uint8Array` (0=false, 1=true)
  - String fields → `{ codes: Uint16Array, categories: string[] }`

```js
engine.filterMapRef(
  [
    {
      op: "filter",
      conditions: [{ field: "age", operator: "gte", value: 18 }],
    },
  ],
  [
    {
      op: "map",
      transforms: [
        {
          field: "bonus",
          expr: {
            type: "arithmetic",
            op: "*",
            left: { type: "field", name: "salary" },
            right: { type: "literal", value: 0.1 },
          },
        },
      ],
    },
  ],
  (ref) => {
    console.log(ref.count); // => 96000
    console.log(ref.columns.salary.constructor.name); // => 'Float64Array'
    console.log(ref.columns.bonus.constructor.name); // => 'Float64Array'
    console.log(ref.columns.department);
    // => { codes: Uint16Array(96000), categories: ['engineering', ...] }

    let totalBonus = 0;
    for (let i = 0; i < ref.count; i++) totalBonus += ref.columns.bonus[i];
    console.log("Total bonus:", totalBonus); // => 768004800
  },
);
```

**Per-group stats using categorical codes — zero row objects:**

```js
engine.filterMapRef(filterOps, mapOps, (ref) => {
  const { codes, categories } = ref.columns.department;
  const bonus = ref.columns.bonus;
  const stats = Object.fromEntries(
    categories.map((c) => [c, { count: 0, total: 0 }]),
  );

  for (let i = 0; i < ref.count; i++) {
    const dept = categories[codes[i]];
    stats[dept].count++;
    stats[dept].total += bonus[i];
  }

  for (const [dept, s] of Object.entries(stats)) {
    console.log(`${dept}: avg bonus $${(s.total / s.count).toFixed(0)}`);
  }
  // => engineering: avg bonus $8000
  // => marketing:   avg bonus $8000
});
```

---

### `groupByIndices(field)`

Groups all row indices by field value. No row objects created.

```js
const groups = engine.groupByIndices("department");
// => {
//   engineering: Uint32Array [0, 5, 10, ...],
//   marketing:   Uint32Array [1, 6, 11, ...],
// }
```

---

## Utility Methods

```js
engine.len(); // → number  — total row count
engine.is_empty(); // → boolean — true if no rows
engine.free(); // → void    — release WASM memory (required)
```

---

## Windowing

All APIs accept `PipelineOptions` as the last argument:

```ts
interface PipelineOptions {
  limit?: number; // max rows to process
  offset?: number; // skip first N rows
}
```

```js
// Process rows 1000–1019 only
engine.query(ops, { offset: 1000, limit: 20 });
engine.filterMapRef(filterOps, mapOps, callback, { limit: 500 });
```

---

## TypeScript

Full TypeScript definitions in [`js/index.d.ts`](./js/index.d.ts).

```ts
import type {
  RsJs,
  RsJsOptions,
  Operation,
  PipelineResult,
  PipelineOptions,
  Condition,
  ConditionLogic,
  Operator,
  MapExpr,
  ReduceOpInline,
  FilterMapRef,
  FilterSelectionRef,
  MapRefView,
  StrColumnView,
  ColumnView,
} from "rs-js";
```

**Key types:**

| Type                 | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `Operation`          | Discriminated union of all 6 op shapes                             |
| `PipelineResult`     | Discriminated union of all 4 return shapes                         |
| `Condition`          | `{ field, operator: Operator, value }`                             |
| `MapExpr`            | Expression tree: `literal`, `field`, `template`, `arithmetic`      |
| `FilterMapRef`       | Callback arg for `filterMapRef` — gathered typed arrays            |
| `FilterSelectionRef` | Callback arg for `filterViewRef` — sparse indices + column windows |
| `StrColumnView`      | `{ codes: Uint16Array, categories: string[] }`                     |
| `RsJsOptions`        | Threshold configuration                                            |

---

## Architecture

```
js/index.node.cjs    JS wrapper (CJS, Node.js) — smart per-op routing + thresholds
js/index.js          JS wrapper (ESM, browser)
js/index.d.ts        TypeScript definitions
src/lib.rs           #[wasm_bindgen] entrypoints: DataEngine, PreparedQuery
src/engine.rs        execute_for_engine() — row-based pipeline (fallback)
src/column_store.rs  ColumnStore — typed arrays + BitSet; columnar fast path
src/operations/      one file per op: filter, map, reduce, group_by, count, find
```

**Dual data representation:** Every `new RsJs(data)` call builds both a row store (`Vec<Row>`) and a `ColumnStore` (typed arrays). Each query picks the fastest path:

- **Columnar path** (`column_store.rs`): scalar ops (count, reduce, find, groupBy+agg) — BitSet masking, zero row allocation
- **Row-based fallback** (`engine.rs`): array-returning ops (filter, map, groupBy without agg) — deferred cloning via `Working` enum
- **JS path** (`index.node.cjs`): small datasets where WASM FFI overhead exceeds computation time

---

## Build from Source

```sh
# Prerequisites
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# Type-check only (fast, no WASM binary)
cargo check --target wasm32-unknown-unknown

# Build all targets
wasm-pack build --release --target nodejs  --out-dir pkg-node
wasm-pack build --release --target bundler --out-dir pkg
wasm-pack build --release --target web     --out-dir pkg-web

# Tests
cargo test              # Rust unit tests
npm test                # JS integration tests (requires pkg-node build)

# Benchmark
node benchmark.js
BENCH_SIZES=10000,100000 node benchmark.js
```

---

## Examples

| File                                                               | Demonstrates                          |
| ------------------------------------------------------------------ | ------------------------------------- |
| [`examples/01_filter.js`](./examples/01_filter.js)                 | Basic filter operations               |
| [`examples/02_map.js`](./examples/02_map.js)                       | Map transforms + expressions          |
| [`examples/03_reduce.js`](./examples/03_reduce.js)                 | Reduce aggregation                    |
| [`examples/04_group_by.js`](./examples/04_group_by.js)             | GroupBy with aggregates               |
| [`examples/05_count.js`](./examples/05_count.js)                   | Count operations                      |
| [`examples/06_find.js`](./examples/06_find.js)                     | Find first match                      |
| [`examples/07_pipeline.js`](./examples/07_pipeline.js)             | Chained pipelines                     |
| [`examples/08_filter_map_ref.js`](./examples/08_filter_map_ref.js) | `filterMapRef` zero-copy columnar API |

---

## License

MIT
