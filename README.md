# rs-js

**Rust-powered data processing for JavaScript.** Filter, map, reduce, groupBy, count, find — on large datasets with a clean JS API.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

Pre-built WebAssembly included. No Rust toolchain required for npm consumers.

**Features:**
- **6 operations** — filter, map, reduce, groupBy, count, find
- **Chainable pipelines** — filter → map → groupBy, etc.
- **Stateful `DataEngine`** — deserialize data once, query many times (eliminates per-call serialization overhead)
- **TypeScript types** — full discriminated union on return values
- **Zero runtime dependencies** — ships with compiled WASM, nothing to install beyond `npm install rs-js`

---

## Install

```sh
npm install rs-js
```

The `pkg-node/` WASM binary is bundled in the package. You do not need Rust or wasm-pack.

---

## Quick Start

```js
const { process } = require('rs-js');

const users = [
  { name: 'Alice', age: 28, salary: 95000, active: true  },
  { name: 'Bob',   age: 17, salary: 0,     active: false },
  { name: 'Carol', age: 35, salary: 120000,active: true  },
];

const result = await process(users, [
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
  { op: 'reduce', field: 'salary', reducer: 'sum' }
]);

console.log(result); // { type: 'number', value: 215000 }
```

---

## Operations

### filter

Keep rows matching one or more conditions. Default logic is `and`.

```js
// adults in the US
const result = await process(users, [
  {
    op: 'filter',
    logic: 'and',
    conditions: [
      { field: 'age',     operator: 'gte', value: 18   },
      { field: 'country', operator: 'eq',  value: 'US' },
    ]
  }
]);
// result.type === 'array'
// result.value → [{ name: 'Alice', ... }, { name: 'Carol', ... }, { name: 'Frank', ... }]
```

```js
// marketing OR design team
const result = await process(users, [
  {
    op: 'filter',
    logic: 'or',
    conditions: [
      { field: 'department', operator: 'eq', value: 'marketing' },
      { field: 'department', operator: 'eq', value: 'design'    },
    ]
  }
]);
```

---

### map

Transform or add fields per row. Supports field copy, template strings, and arithmetic.

```js
// add bonus (salary × 0.1) and an email field
const result = await process(users, [
  {
    op: 'map',
    transforms: [
      {
        field: 'bonus',
        expr: {
          type: 'arithmetic', op: '*',
          left:  { type: 'field',   name: 'salary' },
          right: { type: 'literal', value: 0.1     }
        }
      },
      {
        field: 'email',
        expr: { type: 'template', template: '{name}@company.com' }
      }
    ]
  }
]);
// result.type === 'array'
// result.value[0] → { name: 'Alice', ..., bonus: 9500, email: 'Alice@company.com' }
```

**MapExpr types:**

| type | fields | example |
|------|--------|---------|
| `literal` | `value` | `{ type: 'literal', value: 42 }` |
| `field` | `name` | `{ type: 'field', name: 'salary' }` |
| `template` | `template` | `{ type: 'template', template: '{first} {last}' }` |
| `arithmetic` | `op`, `left`, `right` | `{ type: 'arithmetic', op: '*', left: ..., right: ... }` |

---

### reduce

Aggregate a numeric field across all rows (or filtered rows).

```js
const total = await process(orders, [
  { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
  { op: 'reduce', field: 'amount', reducer: 'sum' }
]);
// total → { type: 'number', value: 2085.5 }
```

**Reducers:** `sum` · `avg` · `min` · `max` · `first` · `last`

---

### groupBy

Group rows by one or more fields, optionally with aggregates.

```js
// group users by department (returns rows array per group)
const byDept = await process(users, [
  { op: 'groupBy', field: 'department' }
]);
// byDept.type === 'array'
// byDept.value → [{ _group: 'engineering', _count: 4, rows: [...] }, ...]
```

```js
// group with aggregates (returns stats object)
const stats = await process(users, [
  {
    op: 'groupBy',
    field: 'department',
    aggregate: [
      { field: 'salary', reducer: 'avg', alias: 'avg_salary' },
      { field: 'salary', reducer: 'sum', alias: 'payroll'    },
    ]
  }
]);
// stats.type === 'object'
// stats.value → {
//   engineering: { _count: 4, avg_salary: 117500, payroll: 470000 },
//   design:      { _count: 3, avg_salary: 75000,  payroll: 225000 },
//   ...
// }
```

Multi-field grouping:

```js
const result = await process(orders, [
  { op: 'groupBy', field: ['status', 'country'] }
]);
// keys are 'completed||US', 'pending||UK', etc.
```

---

### count

Count all rows, or only rows where a field is truthy.

```js
// total
const total = await process(users, [{ op: 'count' }]);
// { type: 'number', value: 10 }

// count active users
const active = await process(users, [{ op: 'count', field: 'active' }]);
// { type: 'number', value: 8 }

// count after filter
const result = await process(users, [
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
  { op: 'count' }
]);
// { type: 'number', value: 8 }
```

---

### find

Return the first row matching conditions, or `null` if none.

```js
const user = await process(users, [
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 6 }] }
]);
// user.type === 'item'
// user.value → { id: 6, name: 'Frank', salary: 145000, ... }

// miss → null
const miss = await process(users, [
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 99 }] }
]);
// miss.value === null
```

---

## DataEngine — Stateful API

`process()` serializes the entire dataset on every call. For repeated queries over the same data, use `DataEngine`: load data into WASM memory once, then call `.query()` many times without re-serialization.

```js
const { DataEngine } = require('rs-js');

// deserialize once — pay the serialization cost here
const engine = new DataEngine(users);

// subsequent queries skip serialization entirely
const adults = engine.query([
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }
]);
const total = engine.query([
  { op: 'reduce', field: 'salary', reducer: 'sum' }
]);
const byDept = engine.query([
  {
    op: 'groupBy',
    field: 'department',
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }]
  }
]);

// with pagination
const page2 = engine.query(
  [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
  { offset: 4, limit: 4 }
);

console.log(`${engine.len()} rows loaded`);

// free WASM memory when done
engine.free();
```

**When to use `DataEngine`:** Any time you run more than one query against the same dataset — dashboard queries, search-as-you-type, repeated aggregations. The serialization cost is paid once at construction; queries only cross the small ops array across the boundary.

---

## Pipelines

Operations chain left to right. `filter` and `map` are intermediate — they pass results to the next operation. `reduce`, `groupBy`, `count`, and `find` are terminal — they stop the chain and return a result.

```
filter → filter → map → reduce     ✓
filter → groupBy (with aggregates) ✓
map → filter → count               ✓
reduce → filter                    ✗  (reduce is terminal)
```

**Revenue dashboard example:**

```js
const { users, orders } = require('./examples/data.js');

// active US engineers — avg salary + payroll
const teamStats = await process(users, [
  {
    op: 'filter',
    logic: 'and',
    conditions: [
      { field: 'country',    operator: 'eq', value: 'US'          },
      { field: 'active',     operator: 'eq', value: true          },
      { field: 'department', operator: 'eq', value: 'engineering' },
    ]
  },
  {
    op: 'groupBy',
    field: 'department',
    aggregate: [
      { field: 'salary', reducer: 'avg', alias: 'avg_salary' },
      { field: 'salary', reducer: 'sum', alias: 'payroll'    },
    ]
  }
]);
// teamStats.value → { engineering: { _count: 3, avg_salary: 123333, payroll: 370000 } }

// completed orders → revenue by country
const countryRevenue = await process(orders, [
  { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
  {
    op: 'groupBy',
    field: 'country',
    aggregate: [
      { field: 'amount', reducer: 'sum', alias: 'revenue'   },
      { field: 'amount', reducer: 'avg', alias: 'avg_order' },
    ]
  }
]);
// countryRevenue.value → {
//   US: { _count: 4, revenue: 1685.0, avg_order: 421.25 },
//   UK: { _count: 2, revenue: 400.5,  avg_order: 200.25 },
// }
```

---

## Options

Pass as the third argument to `process()`, or second argument to `engine.query()`.

| Option | Type | Description |
|--------|------|-------------|
| `limit` | `number` | Max rows to process |
| `offset` | `number` | Skip first N rows before processing |

```js
// page 3, 5 per page
await process(users, [{ op: 'filter', conditions: [...] }], { offset: 10, limit: 5 });
```

---

## Return Value

Every call returns a `PipelineResult` discriminated union.

| `type` | `value` | returned by |
|--------|---------|-------------|
| `'array'` | `Record<string, unknown>[]` | filter, map, groupBy (no aggregates) |
| `'number'` | `number` | reduce, count |
| `'object'` | `Record<string, Record<string, unknown>>` | groupBy with aggregates |
| `'item'` | `Record<string, unknown> \| null` | find |

**TypeScript narrowing:**

```ts
import { process, PipelineResult } from 'rs-js';

const result: PipelineResult = await process(data, ops);

if (result.type === 'number') {
  console.log(result.value.toFixed(2));        // result.value is number
} else if (result.type === 'array') {
  result.value.forEach(row => console.log(row)); // result.value is Record[]
} else if (result.type === 'item') {
  if (result.value !== null) {
    console.log(result.value.name);             // result.value is Record
  }
} else {
  // result.type === 'object'
  Object.entries(result.value).forEach(([key, stats]) => console.log(key, stats));
}
```

---

## Operators Reference

| Operator | Applies to | Example |
|----------|-----------|---------|
| `eq` | any | `{ operator: 'eq', value: 'US' }` |
| `ne` | any | `{ operator: 'ne', value: null }` |
| `gt` | number | `{ operator: 'gt', value: 100000 }` |
| `gte` | number | `{ operator: 'gte', value: 18 }` |
| `lt` | number | `{ operator: 'lt', value: 30 }` |
| `lte` | number | `{ operator: 'lte', value: 65 }` |
| `contains` | string | `{ operator: 'contains', value: 'alice' }` |
| `startsWith` | string | `{ operator: 'startsWith', value: 'Al' }` |
| `endsWith` | string | `{ operator: 'endsWith', value: '.com' }` |
| `in` | any | `{ operator: 'in', value: ['US', 'CA'] }` |
| `notIn` | any | `{ operator: 'notIn', value: ['pending'] }` |
| `isNull` | any | `{ operator: 'isNull' }` |
| `isNotNull` | any | `{ operator: 'isNotNull' }` |

---

## TypeScript

```ts
import { process, DataEngine, Operation, PipelineOptions, PipelineResult } from 'rs-js';

const ops: Operation[] = [
  {
    op: 'filter',
    logic: 'and',
    conditions: [
      { field: 'age',    operator: 'gte', value: 18   },
      { field: 'active', operator: 'eq',  value: true },
    ]
  },
  { op: 'reduce', field: 'salary', reducer: 'sum' }
];

const result: PipelineResult = await process(users, ops);

if (result.type === 'number') {
  console.log(`Total payroll: $${result.value.toLocaleString()}`);
}

// stateful engine
const engine = new DataEngine(users);
const count: PipelineResult = engine.query([{ op: 'count' }]);
engine.free();
```

---

## Browser / Bundler (ESM)

```js
import { process, createEngine } from 'rs-js';

// one-shot
const result = await process(data, ops);

// stateful — async factory, returns DataEngine
const engine = await createEngine(data);
const result2 = engine.query(ops);
engine.free();
```

The ESM entry (`js/index.js`) lazy-loads the WASM bundle. First call initializes it; subsequent calls reuse it.

---

## Examples

```sh
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

All examples use the same 10-user / 10-order / 10-event dataset in `examples/data.js`.

---

## Build from Source

Requires Rust and wasm-pack.

```sh
# one-time setup
cargo install wasm-pack

# build all targets (nodejs + web + bundler)
npm run build:all

# nodejs only (faster iteration)
npm run build

# run Rust unit tests
npm run test:rust
```

Build output: `pkg-node/` (Node.js CJS), `pkg/` (bundler ESM), `pkg-web/` (browser ESM).

---

## License

MIT
