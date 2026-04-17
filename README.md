# rs-js

**Rust-powered data processing for JavaScript.** Fast, type-safe filtering, mapping, and reducing on large datasets.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

`rs-js` brings Rust's performance to JavaScript data processing. It automatically chooses the fastest path — whether that's optimized WebAssembly columnar scans, bitmask-based filtering, or native JS for very small datasets.

**Features:**
- **Single Unified Engine** — No manual configuration, just peak performance by default.
- **Extreme Speed** — Up to **15-20x faster** than native JS for large-scale math and filtering.
- **Stateful `DataEngine`** — Load data once, query many times (zero-copy pipelines).
- **TypeScript types** — Full discriminated union on return values.

---

## Install

```sh
npm install rs-js
```

---

## Quick Start

```js
const { DataEngine } = require('rs-js');

const users = [
  { name: 'Alice', age: 28, salary: 95000, active: true  },
  { name: 'Bob',   age: 17, salary: 0,     active: false },
  { name: 'Carol', age: 35, salary: 120000,active: true  },
];

// Load once
const engine = new DataEngine(users);

// Query many times
const result = engine.query([
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
  { op: 'reduce', field: 'salary', reducer: 'sum' }
]);

console.log(result); // { type: 'number', value: 215000 }

// Free memory when done
engine.free();
```

---

## Operations

### query

The main entry point for all processing. Accepts a pipeline of operations.

```js
const result = engine.query([
  {
    op: 'filter',
    conditions: [{ field: 'age', operator: 'gte', value: 18 }]
  },
  {
    op: 'groupBy',
    field: 'department',
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }]
  }
]);
```

**Supported Operations:** `filter`, `map`, `reduce`, `groupBy`, `count`, `find`.

---

### Intermediate vs Terminal

Operations chain from left to right.
- **Intermediate:** `filter`, `map` (return rows to the next step).
- **Terminal:** `reduce`, `groupBy`, `count`, `find` (return a final value).

---

## Performance Notes

`rs-js` is optimized for datasets from **10,000 to 1,000,000+ rows**.

- **Internal Caching:** Operations are automatically compiled and cached. Re-running the same pipeline is near-instant.
- **Bitmask Filtering:** Filters are evaluated across entire columns at once, avoiding row-by-row branching.
- **Index-Only Pipelines:** Intermediate steps pass row indices instead of cloning data, overcoming the "WASM-JS boundary wall."

---

## Options

Pass as the second argument to `engine.query()`.

| Option | Type | Description |
|--------|------|-------------|
| `limit` | `number` | Max rows to process |
| `offset` | `number` | Skip first N rows before processing |

```js
engine.query(pipeline, { offset: 10, limit: 5 });
```

---

## Browser / Bundler (ESM)

```js
import { createEngine } from 'rs-js';

const engine = await createEngine(data);
const result = engine.query(pipeline);
engine.free();
```

---

## Build from Source

Requires Rust and wasm-pack.

```sh
npm run build:all
npm run test:rust
```

---

## License

MIT
