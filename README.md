# rs-js

> High-performance data processing for JavaScript, powered by Rust + WebAssembly.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

rs-js is a Node.js and browser library that moves heavy data operations — filtering, mapping, reducing, grouping — into Rust compiled to WebAssembly. Your data is processed in Rust-owned memory with no JSON round-trip. Results come back as plain JavaScript objects.

**Pre-built WebAssembly included. No Rust installation required.**

**Core Operations:**
- **filter** — query rows by field conditions (eq, gt, contains, in, isNull, …)
- **map** — transform fields using templates, arithmetic, or literal values
- **reduce** — aggregate a numeric field (sum, avg, min, max, first, last)
- **groupBy** — partition rows by one or more fields, with optional per-group aggregates
- **count** — count rows, optionally after a filter
- **find** — return the first matching row, or `null`

**Pipeline support:** chain any combination of operations in a single `process()` call.

---

## Install

```bash
npm install rs-js
```

No Rust or wasm-pack required. The compiled `.wasm` binary is bundled in the package.

---

## Quick Start

```js
const { process } = require('rs-js');

// Total revenue from completed orders
const result = await process(orders, [
  { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
  { op: 'reduce', field: 'amount', reducer: 'sum' }
]);

console.log(result.value); // 2085.50
```

---

## API

### `process(data, operations, options?)`

| Parameter    | Type                        | Description               |
|--------------|-----------------------------|---------------------------|
| `data`       | `Record<string, unknown>[]` | Array of plain objects    |
| `operations` | `Operation[]`               | Pipeline steps to execute |
| `options`    | `PipelineOptions`           | Optional (see below)      |

Returns a `PipelineResult` — a tagged union `{ type, value }` (see [Return Value](#return-value)).

---

## Operations

### filter

Filter rows by one or more conditions. Conditions combine with `and` (default) or `or`.

```js
// Adults only
const result = await process(users, [
  {
    op: 'filter',
    conditions: [{ field: 'age', operator: 'gte', value: 18 }]
  }
]);
// result.type → 'array'
// result.value → [{ name: 'Alice', age: 28, … }, …]

// Active senior engineers — multi-condition AND
const result = await process(users, [
  {
    op: 'filter',
    logic: 'and',
    conditions: [
      { field: 'active',     operator: 'eq', value: true          },
      { field: 'department', operator: 'eq', value: 'engineering' },
      { field: 'salary',     operator: 'gt', value: 100000        }
    ]
  }
]);

// Marketing OR design — multi-condition OR
const result = await process(users, [
  {
    op: 'filter',
    logic: 'or',
    conditions: [
      { field: 'department', operator: 'eq', value: 'marketing' },
      { field: 'department', operator: 'eq', value: 'design'    }
    ]
  }
]);
```

---

### map

Add or overwrite fields on every row. Three expression types: `field` (copy), `template` (string interpolation), `arithmetic` (+, -, *, /).

```js
// Build full name from two fields
const result = await process(users, [
  {
    op: 'map',
    transforms: [
      { field: 'fullName', expr: { type: 'template', template: '{first} {last}' } }
    ]
  }
]);
// result.value[0].fullName → 'Alice Smith'

// Compute annual bonus (salary × 0.1)
const result = await process(users, [
  {
    op: 'map',
    transforms: [
      {
        field: 'bonus',
        expr: {
          type: 'arithmetic',
          op: '*',
          left:  { type: 'field',   name: 'salary' },
          right: { type: 'literal', value: 0.1     }
        }
      }
    ]
  }
]);
// result.value[0].bonus → 9500  (for salary: 95000)

// Add a static tag to every row
const result = await process(users, [
  {
    op: 'map',
    transforms: [
      { field: 'source', expr: { type: 'literal', value: 'hr-export-2025' } }
    ]
  }
]);
```

---

### reduce

Aggregate all values of a numeric field into a single number. Terminal operation — must be last in a pipeline.

```js
// Sum of completed order amounts
const result = await process(orders, [
  { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
  { op: 'reduce', field: 'amount', reducer: 'sum' }
]);
// result.type  → 'number'
// result.value → 2085.5

// Average engineering salary
const result = await process(users, [
  { op: 'filter', conditions: [{ field: 'department', operator: 'eq', value: 'engineering' }] },
  { op: 'reduce', field: 'salary', reducer: 'avg' }
]);
// result.value → 117500
```

**Reducers:** `sum` · `avg` · `min` · `max` · `first` · `last`

---

### groupBy

Partition rows by one or more fields. Without `aggregate`, returns grouped rows. With `aggregate`, returns per-group statistics.

```js
// Group users by country (no aggregates)
const result = await process(users, [
  { op: 'groupBy', field: 'country' }
]);
// result.type → 'array'
// result.value → [{ _group: 'US', _count: 4, country: 'US', rows: […] }, …]

// Department stats with aggregates
const result = await process(users, [
  {
    op: 'groupBy',
    field: 'department',
    aggregate: [
      { field: 'salary', reducer: 'avg', alias: 'avg_salary'    },
      { field: 'salary', reducer: 'sum', alias: 'total_payroll' }
    ]
  }
]);
// result.type → 'object'
// result.value → {
//   engineering: { _count: 4, avg_salary: 117500, total_payroll: 470000 },
//   marketing:   { _count: 3, avg_salary: 18333,  total_payroll: 55000  },
//   design:      { _count: 3, avg_salary: 75000,  total_payroll: 225000 }
// }

// Multi-field grouping
const result = await process(users, [
  { op: 'groupBy', field: ['country', 'department'] }
]);
// Keys are joined: 'US||engineering', 'CA||design', …
```

---

### count

Count rows. Pass `field` to count only rows where that field is truthy and non-null.

```js
// Count all rows
const result = await process(users, [{ op: 'count' }]);
// result.type  → 'number'
// result.value → 10

// Count after filter
const result = await process(users, [
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
  { op: 'count' }
]);
// result.value → 8

// Conversion rate
const total     = await process(events, [{ op: 'count' }]);
const purchases = await process(events, [
  { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: 'purchase' }] },
  { op: 'count' }
]);
const rate = (purchases.value / total.value * 100).toFixed(1); // '30.0'
```

---

### find

Return the first row matching the conditions, or `null` if nothing matches.

```js
// Find by ID
const result = await process(users, [
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 3 }] }
]);
// result.type       → 'item'
// result.value      → { id: 3, name: 'Carol', … }
// result.value.name → 'Carol'

// Returns null when no match
const result = await process(users, [
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 999 }] }
]);
// result.value → null

// Multi-condition find
const result = await process(users, [
  {
    op: 'find',
    logic: 'and',
    conditions: [
      { field: 'country', operator: 'eq', value: 'UK'   },
      { field: 'salary',  operator: 'gt', value: 80000  },
      { field: 'active',  operator: 'eq', value: true   }
    ]
  }
]);
// result.value → { name: 'Iris', salary: 110000, … }
```

---

## Pipelines

Operations chain in a single `process()` call. `filter` and `map` are intermediate (they pass rows forward). `reduce`, `groupBy`, `count`, and `find` are terminal (they consume rows and return a final value).

```js
// Revenue dashboard — filter → reduce (parallel)
const [total, average, count] = await Promise.all([
  process(orders, [
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'reduce', field: 'amount', reducer: 'sum' }
  ]),
  process(orders, [
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'reduce', field: 'amount', reducer: 'avg' }
  ]),
  process(orders, [
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'count' }
  ])
]);
// total.value   → 2085.5
// average.value → 347.58
// count.value   → 6

// Enrich active engineers — filter → map
const result = await process(users, [
  {
    op: 'filter',
    logic: 'and',
    conditions: [
      { field: 'active',     operator: 'eq', value: true          },
      { field: 'department', operator: 'eq', value: 'engineering' }
    ]
  },
  {
    op: 'map',
    transforms: [
      { field: 'email',       expr: { type: 'template', template: '{name}@company.com' } },
      { field: 'displayName', expr: { type: 'template', template: '{first} {last}'     } }
    ]
  }
]);
// result.value[0] → { …, email: 'Alice@company.com', displayName: 'Alice Smith' }

// Analytics — filter → groupBy with aggregates
const result = await process(orders, [
  { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
  {
    op: 'groupBy',
    field: 'country',
    aggregate: [
      { field: 'amount', reducer: 'sum', alias: 'revenue'   },
      { field: 'amount', reducer: 'avg', alias: 'avg_order' }
    ]
  }
]);
// result.value → {
//   US: { _count: 5, revenue: 1765.5,  avg_order: 353.1 },
//   UK: { _count: 1, revenue: 320,     avg_order: 320   }
// }
```

---

## Options

Pass a third argument to `process()` to slice data before the pipeline runs.

| Option        | Type      | Description                         |
|---------------|-----------|-------------------------------------|
| `limit`       | `number`  | Max rows to process                 |
| `offset`      | `number`  | Skip first N rows                   |
| `includeMeta` | `boolean` | Reserved (no effect in v0.1.0)      |

```js
// Process only rows 3–7
const result = await process(users, [{ op: 'count' }], { offset: 2, limit: 5 });
// result.value → 5
```

---

## Return Value

Every `process()` call returns a tagged union. Check `result.type` to know the shape of `result.value`.

| `type`    | `value` shape                                       | Returned by                        |
|-----------|-----------------------------------------------------|------------------------------------|
| `array`   | `Record<string, unknown>[]`                         | filter, map, groupBy (no aggregate)|
| `number`  | `number`                                            | reduce, count                      |
| `object`  | `Record<string, Record<string, unknown>>`           | groupBy with aggregates            |
| `item`    | `Record<string, unknown> \| null`                   | find                               |

---

## Operators Reference

| Operator     | Applies to       | Example `value`          |
|--------------|------------------|--------------------------|
| `eq`         | any              | `'completed'`, `true`, `42` |
| `ne`         | any              | `'pending'`              |
| `gt`         | number, string   | `18`                     |
| `gte`        | number, string   | `18`                     |
| `lt`         | number, string   | `100000`                 |
| `lte`        | number, string   | `100000`                 |
| `contains`   | string           | `'eng'`                  |
| `startsWith` | string           | `'Al'`                   |
| `endsWith`   | string           | `'ing'`                  |
| `in`         | any              | `['US', 'CA']`           |
| `notIn`      | any              | `['cancelled']`          |
| `isNull`     | any              | *(no value needed)*      |
| `isNotNull`  | any              | *(no value needed)*      |

String comparisons for `gt`, `gte`, `lt`, `lte` are lexicographic.

---

## TypeScript

Full type definitions are included. Import types from the package root.

```ts
import { process } from 'rs-js';
import type { Operation, PipelineResult, PipelineOptions } from 'rs-js';

const ops: Operation[] = [
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
  { op: 'groupBy', field: 'country', aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] }
];

const result: PipelineResult = await process(users, ops);

// Narrow the type before accessing .value
if (result.type === 'object') {
  for (const [country, stats] of Object.entries(result.value)) {
    console.log(country, stats.avg_salary);
  }
}
```

---

## Browser / Bundler

For Vite, webpack, or Rollup, import from `rs-js`. The ESM build initializes the WASM lazily on first call.

```js
import { process } from 'rs-js';

const result = await process(data, [
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }
]);
```

For a `<script type="module">` (no bundler), use the web build from `rs-js/pkg-web`.

---

## Running the Examples

Clone the repo and run any example directly — no extra setup needed after install.

```bash
git clone https://github.com/shaon07/rs-js
cd rs-js
npm install

node examples/01_filter.js
node examples/02_map.js
node examples/03_reduce.js
node examples/04_group_by.js
node examples/05_count.js
node examples/06_find.js
node examples/07_pipeline.js
```

Each file is self-contained with sample data (users, orders, events datasets).

---

## Build from Source

Only needed if you want to modify the Rust core.

**Requirements:** Rust toolchain (`rustup`), `wasm-pack`

```bash
# Install wasm-pack (one-time)
cargo install wasm-pack

# Build for Node.js
npm run build

# Build for all targets (Node.js + browser ESM + bundler)
npm run build:all

# Run Rust unit tests (native, no WASM runner needed)
npm run test:rust
```

---

## Project Structure

```
src/
  lib.rs            wasm-bindgen entrypoint
  engine.rs         pipeline executor
  eval.rs           shared condition evaluator
  types.rs          Operation enum, PipelineResult, Row types
  operations/       filter, map, reduce, group_by, count, find
js/
  index.node.cjs    Node.js wrapper (CJS, auto-loads WASM)
  index.js          ESM wrapper (browser/bundler)
  index.d.ts        TypeScript definitions
examples/
  data.js           shared sample dataset
  01_filter.js … 07_pipeline.js
```

---

## License

MIT
