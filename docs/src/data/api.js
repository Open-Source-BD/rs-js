export const categories = [
  {
    id: 'core',
    name: 'Core',
    methods: [
      {
        id: 'constructor',
        name: 'new RsJs',
        signature: 'new RsJs(data, [options])',
        returnType: 'RsJs',
        since: '1.0.0',
        description:
          'Creates a stateful data engine. Data is deserialized once into WASM linear memory. Call .query() many times without re-serializing the dataset. Call .free() when done to release WASM memory.',
        params: [
          {
            name: 'data',
            type: 'Record<string, unknown>[]',
            description: 'Array of row objects. Each object is one record.',
          },
          {
            name: '[options]',
            type: 'RsJsOptions',
            description:
              'Optional configuration. filterThreshold, mapThreshold, groupByThreshold control when the engine switches from JS to WASM path. smallRowThreshold overrides all three.',
          },
        ],
        returns: 'New RsJs engine instance.',
        examples: [
          {
            code: `const { RsJs } = require('@shaon07/rs-js');

const users = [
  { id: 1, name: 'Alice', age: 32, salary: 85000, active: true,  department: 'engineering' },
  { id: 2, name: 'Bob',   age: 24, salary: 62000, active: false, department: 'marketing'   },
  { id: 3, name: 'Carol', age: 41, salary: 97000, active: true,  department: 'engineering' },
];

const engine = new RsJs(users);
engine.len();      // => 3
engine.is_empty(); // => false

// Custom thresholds — override when WASM vs JS crossover happens
const engine2 = new RsJs(users, {
  filterThreshold:  5_000,   // default 15,000
  groupByThreshold: 10_000,  // default 30,000
});`,
          },
        ],
      },
      {
        id: 'create-rs-js',
        name: 'createRsJs',
        signature: 'createRsJs(data, [options])',
        returnType: 'Promise<RsJs>',
        since: '1.0.0',
        description:
          'Async factory for browser and ESM environments. Initializes the WASM module then creates an RsJs engine. Use this instead of new RsJs() in bundler projects.',
        params: [
          {
            name: 'data',
            type: 'Record<string, unknown>[]',
            description: 'Array of row objects.',
          },
          {
            name: '[options]',
            type: 'RsJsOptions',
            description: 'Optional configuration thresholds.',
          },
        ],
        returns: 'Promise<RsJs> — resolves once the WASM module is ready.',
        examples: [
          {
            code: `import { createRsJs } from '@shaon07/rs-js';

const data = await fetch('/api/users').then(r => r.json());
const engine = await createRsJs(data);

const result = engine.query([
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }
]);
console.log(result.value.length); // => 1842

engine.free();`,
          },
        ],
      },
    ],
  },
  {
    id: 'query',
    name: 'Query',
    methods: [
      {
        id: 'query',
        name: 'query',
        signature: 'engine.query(operations, [options])',
        returnType: 'PipelineResult',
        since: '1.0.0',
        description:
          'Execute a pipeline of operations against the dataset. Operations execute left-to-right. filter and map are intermediate (chainable); reduce, groupBy, count, find are terminal.',
        note: 'Returns a discriminated union tagged by type. Always check result.type before accessing result.value.',
        params: [
          {
            name: 'operations',
            type: 'Operation[]',
            description:
              'Array of operation descriptors. Each has an "op" field identifying its type. See the Operations section for all supported shapes.',
          },
          {
            name: '[options]',
            type: 'PipelineOptions',
            description: 'limit, offset for windowing the input dataset before processing.',
          },
        ],
        returns: `PipelineResult — discriminated union:
• { type: 'array',  value: Record<string, unknown>[] }           — filter, map, groupBy (no agg)
• { type: 'number', value: number }                               — reduce, count
• { type: 'object', value: Record<string, Record<string, unknown>> } — groupBy with aggregates
• { type: 'item',   value: Record<string, unknown> | null }      — find`,
        examples: [
          {
            label: 'Filter',
            code: `const result = engine.query([
  { op: 'filter', conditions: [
    { field: 'age',    operator: 'gte', value: 18   },
    { field: 'active', operator: 'eq',  value: true }
  ]}
]);
// => { type: 'array', value: [{ id: 1, name: 'Alice', age: 32, ... }, ...] }`,
          },
          {
            label: 'Map — compute new field',
            code: `const result = engine.query([
  { op: 'map', transforms: [{
    field: 'bonus',
    expr: { type: 'arithmetic', op: '*',
      left:  { type: 'field',   name: 'salary' },
      right: { type: 'literal', value: 0.1     } }
  }]}
]);
// => { type: 'array', value: [{ ..., bonus: 8500 }, { ..., bonus: 6200 }, ...] }`,
          },
          {
            label: 'Reduce — aggregate',
            code: `const result = engine.query([
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
  { op: 'reduce', field: 'salary', reducer: 'sum' }
]);
// => { type: 'number', value: 48302000 }`,
          },
          {
            label: 'GroupBy + aggregates',
            code: `const result = engine.query([
  { op: 'groupBy', field: 'department',
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] }
]);
// => { type: 'object', value: {
//      engineering: { _count: 420, avg_salary: 91200 },
//      marketing:   { _count: 310, avg_salary: 74500 },
//    }}`,
          },
          {
            label: 'Count',
            code: `const result = engine.query([
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
  { op: 'count' }
]);
// => { type: 'number', value: 9600 }`,
          },
          {
            label: 'Find',
            code: `const result = engine.query([
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 42 }] }
]);
// => { type: 'item', value: { id: 42, name: 'Dana', age: 29, ... } }`,
          },
          {
            label: 'Pipeline — filter → map → groupBy',
            code: `const result = engine.query([
  { op: 'filter', conditions: [
    { field: 'active', operator: 'eq',  value: true },
    { field: 'age',    operator: 'gte', value: 18   }
  ]},
  { op: 'map', transforms: [{
    field: 'email',
    expr:  { type: 'template', template: '{name}@company.com' }
  }]},
  { op: 'groupBy', field: 'department',
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] }
]);
// => { type: 'object', value: { engineering: { _count: 312, avg_salary: 94100 }, ... } }`,
          },
          {
            label: 'Windowing — offset + limit',
            code: `const result = engine.query(
  [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
  { offset: 100, limit: 20 }
);
// => { type: 'array', value: [ 20 rows starting from row 100 of the dataset ] }`,
          },
        ],
      },
    ],
  },
  {
    id: 'zero-copy',
    name: 'Zero-Copy APIs',
    methods: [
      {
        id: 'filter-indices',
        name: 'filterIndices',
        signature: 'engine.filterIndices(operations, [options])',
        returnType: 'Uint32Array',
        since: '1.0.0',
        description:
          'Returns matching row indices as a Uint32Array without deserializing any row data. Use when you need to know which rows match and want to access the original JS objects directly.',
        params: [
          { name: 'operations', type: 'Operation[]', description: 'Filter operations.' },
          { name: '[options]', type: 'PipelineOptions', description: 'Optional limit/offset windowing.' },
        ],
        returns: 'Uint32Array of matching row indices (0-based, into the original data array).',
        examples: [
          {
            code: `const indices = engine.filterIndices([
  { op: 'filter', conditions: [
    { field: 'department', operator: 'eq',  value: 'engineering' },
    { field: 'salary',     operator: 'gte', value: 80000         }
  ]}
]);
console.log(indices.constructor.name); // => 'Uint32Array'
console.log(indices.length);           // => 142

// Access original JS objects directly by index
for (const idx of indices) {
  console.log(data[idx].name, data[idx].salary);
}
// => 'Alice' 85000
// => 'Carol' 97000`,
          },
        ],
      },
      {
        id: 'filter-view-ref',
        name: 'filterViewRef',
        signature: 'engine.filterViewRef(operations, callback, [options])',
        returnType: 'unknown',
        since: '1.0.0',
        description:
          'Zero-copy columnar filter. Calls callback with sparse indices and typed-array column views directly into WASM linear memory. No row objects created. Views are only valid inside the callback — do not retain references.',
        note: 'Do not call any other WASM methods while views are live. Any Rust allocation can invalidate the backing memory.',
        params: [
          { name: 'operations', type: 'Operation[]', description: 'Filter operations.' },
          {
            name: 'callback',
            type: '(view: FilterSelectionRef) => unknown',
            description:
              'Receives { indices: Uint32Array, columns: { [field]: Float64Array | Uint8Array | StrColumnView } }. Views valid only inside callback.',
          },
          { name: '[options]', type: 'PipelineOptions', description: 'Optional limit/offset.' },
        ],
        returns: 'Return value of the callback.',
        examples: [
          {
            code: `engine.filterViewRef(
  [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }],
  (ref) => {
    // Typed arrays — zero-copy views into WASM memory
    console.log(ref.indices.constructor.name);         // => 'Uint32Array'
    console.log(ref.columns.salary.constructor.name);  // => 'Float64Array'
    console.log(ref.columns.active.constructor.name);  // => 'Uint8Array'
    console.log(ref.columns.department);
    // => { codes: Uint16Array(96000), categories: ['engineering', 'marketing', ...] }

    // Aggregate without creating a single row object
    let totalSalary = 0;
    const salary = ref.columns.salary;
    for (let i = 0; i < ref.indices.length; i++) {
      totalSalary += salary[i];
    }
    return totalSalary;
  }
);
// => 48302000`,
          },
        ],
      },
      {
        id: 'map-ref',
        name: 'mapRef',
        signature: 'engine.mapRef(operations, callback, [options])',
        returnType: 'unknown',
        since: '1.0.0',
        description:
          'Zero-copy map returning computed column arrays. Field projections return zero-copy TypedArray subarrays into WASM memory (stable until .free()). Arithmetic expressions return a new Float64Array on the JS heap. Template/string expressions return JS string arrays.',
        params: [
          { name: 'operations', type: 'Operation[]', description: 'Map operations with transform expressions.' },
          {
            name: 'callback',
            type: '(view: MapRefView) => unknown',
            description:
              'Receives { [field]: Float64Array | Uint8Array | Uint16Array | StrColumnView | unknown[] }.',
          },
          { name: '[options]', type: 'PipelineOptions', description: 'Optional limit/offset.' },
        ],
        returns: 'Return value of the callback.',
        examples: [
          {
            label: 'Arithmetic — ~8x faster than row-object map',
            code: `let totalBonus = 0;

engine.mapRef(
  [{ op: 'map', transforms: [{
    field: 'bonus',
    expr: { type: 'arithmetic', op: '*',
      left:  { type: 'field',   name: 'salary' },
      right: { type: 'literal', value: 0.1     } }
  }]}],
  (ref) => {
    const bonus = ref.bonus; // Float64Array
    for (let i = 0; i < bonus.length; i++) totalBonus += bonus[i];
  }
);
console.log(totalBonus); // => 4920000`,
          },
          {
            label: 'Field projection — zero-copy, ~29x faster',
            code: `engine.mapRef(
  [{ op: 'map', transforms: [
    { field: 'salary_view', expr: { type: 'field', name: 'salary' } }
  ]}],
  (ref) => {
    const salaries = ref.salary_view; // Float64Array (zero-copy subarray into WASM memory)
    console.log(salaries[0]);         // => 85000
    console.log(salaries.length);     // => 100000
  }
);`,
          },
        ],
      },
      {
        id: 'filter-map-ref',
        name: 'filterMapRef',
        signature: 'engine.filterMapRef(filterOps, mapOps, callback, [options])',
        returnType: 'void',
        since: '1.1.0',
        description:
          'Combined filter + map into gathered typed-array columns. Filters with a BitSet, gathers original columns to matched rows, computes map transforms — all in Rust. Returns zero-copy views valid only inside the callback. 5–18× faster than row-object output depending on dataset composition.',
        note: 'Views are zero-copy into WASM linear memory — do not retain references after callback returns. Datasets with low-cardinality string columns show the largest speedups.',
        params: [
          {
            name: 'filterOps',
            type: 'Operation[]',
            description: 'Filter operations applied first to select matching rows.',
          },
          {
            name: 'mapOps',
            type: 'Operation[]',
            description: 'Map operations applied to matched rows to compute new columns.',
          },
          {
            name: 'callback',
            type: '(ref: FilterMapRef) => void',
            description: `Receives FilterMapRef:
• ref.count   — number of matched rows
• ref.indices — Uint32Array of original row indices
• ref.columns — all original columns gathered to matched rows, plus computed columns
  Numeric  → Float64Array
  Boolean  → Uint8Array (0 = false, 1 = true)
  String   → { codes: Uint16Array, categories: string[] }`,
          },
          { name: '[options]', type: 'PipelineOptions', description: 'Optional limit/offset.' },
        ],
        returns: 'void',
        examples: [
          {
            label: 'Inspect column shapes',
            code: `engine.filterMapRef(
  [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }],
  [{ op: 'map', transforms: [{
    field: 'bonus',
    expr: { type: 'arithmetic', op: '*',
      left:  { type: 'field',   name: 'salary' },
      right: { type: 'literal', value: 0.1     } }
  }]}],
  (ref) => {
    console.log(ref.count);                            // => 96000
    console.log(ref.indices.constructor.name);         // => 'Uint32Array'
    console.log(ref.columns.salary.constructor.name);  // => 'Float64Array'
    console.log(ref.columns.bonus.constructor.name);   // => 'Float64Array'
    console.log(ref.columns.active.constructor.name);  // => 'Uint8Array'
    console.log(ref.columns.department);
    // => { codes: Uint16Array(96000), categories: ['engineering', 'marketing', 'sales', 'hr', 'design'] }
  }
);`,
          },
          {
            label: 'Aggregate inside callback — zero row objects',
            code: `let totalBonus = 0, maxSalary = 0;

engine.filterMapRef(
  [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
  [{ op: 'map', transforms: [
    { field: 'bonus', expr: { type: 'arithmetic', op: '*',
        left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } },
    { field: 'tax',   expr: { type: 'arithmetic', op: '*',
        left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.3 } } }
  ]}],
  (ref) => {
    const { bonus, salary } = ref.columns;
    for (let i = 0; i < ref.count; i++) {
      totalBonus += bonus[i];
      if (salary[i] > maxSalary) maxSalary = salary[i];
    }
  }
);
console.log('Total bonus:', totalBonus); // => Total bonus: 768004800
console.log('Max salary:', maxSalary);   // => Max salary: 129999`,
          },
          {
            label: 'Per-department stats via categorical codes',
            code: `engine.filterMapRef(
  [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
  [{ op: 'map', transforms: [{
    field: 'bonus',
    expr: { type: 'arithmetic', op: '*',
      left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } }
  }]}],
  (ref) => {
    const { codes, categories } = ref.columns.department;
    const bonus = ref.columns.bonus;

    const stats = Object.fromEntries(categories.map(c => [c, { count: 0, total: 0 }]));
    for (let i = 0; i < ref.count; i++) {
      const dept = categories[codes[i]];
      stats[dept].count++;
      stats[dept].total += bonus[i];
    }

    for (const [dept, s] of Object.entries(stats)) {
      const avg = (s.total / s.count).toFixed(0);
      console.log(\`\${dept}: \${s.count} employees, avg bonus $\${Number(avg).toLocaleString()}\`);
    }
    // => engineering: 13333 employees, avg bonus $8,000
    // => marketing:   13333 employees, avg bonus $8,000
    // => sales:       13334 employees, avg bonus $8,000
    // => hr:          13333 employees, avg bonus $8,000
    // => design:      13333 employees, avg bonus $8,000
  }
);`,
          },
        ],
      },
      {
        id: 'group-by-indices',
        name: 'groupByIndices',
        signature: 'engine.groupByIndices(field)',
        returnType: 'Record<string, Uint32Array>',
        since: '1.0.0',
        description:
          "Groups all row indices by a field's value. Returns a plain object mapping each distinct value to a Uint32Array of matching row indices. No row objects created.",
        params: [
          {
            name: 'field',
            type: 'string',
            description:
              'Field to group by. Supports all column types: string (categorical codes), number (bit-pattern bucketing), boolean (buckets: "true" / "false" / "null").',
          },
        ],
        returns: 'Object mapping group key strings to Uint32Array of row indices.',
        examples: [
          {
            code: `const groups = engine.groupByIndices('department');
// => {
//   engineering: Uint32Array [0, 5, 10, 15, ...],
//   marketing:   Uint32Array [1, 6, 11, 16, ...],
//   sales:       Uint32Array [2, 7, 12, 17, ...],
//   hr:          Uint32Array [3, 8, 13, 18, ...],
//   design:      Uint32Array [4, 9, 14, 19, ...]
// }

for (const [dept, ids] of Object.entries(groups)) {
  console.log(\`\${dept}: \${ids.length} employees\`);
}
// => engineering: 20000 employees
// => marketing:   20000 employees

// Boolean grouping
const activityGroups = engine.groupByIndices('active');
// => { true: Uint32Array [...], false: Uint32Array [...] }`,
          },
        ],
      },
    ],
  },
  {
    id: 'operations',
    name: 'Operations',
    methods: [
      {
        id: 'op-filter',
        name: 'filter',
        signature: '{ op: "filter", conditions, [logic] }',
        returnType: 'intermediate',
        since: '1.0.0',
        description:
          'Filters rows by one or more conditions combined with AND logic by default. Set logic: "or" for any-condition matching.',
        params: [
          {
            name: 'conditions',
            type: 'Condition[]',
            description:
              'Array of { field, operator, value }. Operators: eq, ne, gt, gte, lt, lte, contains, startsWith, endsWith, in, notIn, isNull, isNotNull.',
          },
          { name: '[logic]', type: '"and" | "or"', description: 'How conditions combine. Default: "and".' },
        ],
        returns: 'Intermediate — chainable into map, reduce, groupBy, count.',
        examples: [
          {
            label: 'Single condition',
            code: `engine.query([
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }
]);
// => { type: 'array', value: [ rows where age >= 18 ] }`,
          },
          {
            label: 'Multiple conditions (AND)',
            code: `engine.query([
  { op: 'filter', conditions: [
    { field: 'department', operator: 'eq',  value: 'engineering' },
    { field: 'salary',     operator: 'gte', value: 90000         },
    { field: 'active',     operator: 'eq',  value: true          }
  ]}
]);`,
          },
          {
            label: 'OR logic',
            code: `engine.query([
  { op: 'filter', logic: 'or', conditions: [
    { field: 'department', operator: 'eq', value: 'hr'     },
    { field: 'department', operator: 'eq', value: 'design' }
  ]}
]);`,
          },
          {
            label: 'in / notIn',
            code: `engine.query([
  { op: 'filter', conditions: [
    { field: 'department', operator: 'in', value: ['engineering', 'design'] }
  ]}
]);`,
          },
          {
            label: 'String operators',
            code: `engine.query([
  { op: 'filter', conditions: [
    { field: 'name',  operator: 'startsWith', value: 'A'     },
    { field: 'email', operator: 'contains',   value: '@corp' }
  ]}
]);`,
          },
        ],
      },
      {
        id: 'op-map',
        name: 'map',
        signature: '{ op: "map", transforms }',
        returnType: 'intermediate',
        since: '1.0.0',
        description:
          'Adds or overwrites computed fields on each row. Transforms are applied in order. Supports arithmetic, field projection, string templates, and literal values.',
        params: [
          {
            name: 'transforms',
            type: 'Array<{ field: string, expr: MapExpr }>',
            description: 'Each transform names a new (or existing) field and an expression to compute its value.',
          },
        ],
        returns: 'Intermediate — chainable into groupBy, reduce, count.',
        examples: [
          {
            label: 'Arithmetic — field OP literal',
            code: `engine.query([
  { op: 'map', transforms: [{
    field: 'bonus',
    expr: { type: 'arithmetic', op: '*',
      left:  { type: 'field',   name: 'salary' },
      right: { type: 'literal', value: 0.1     } }
  }]}
]);
// => { type: 'array', value: [{ ..., bonus: 8500 }, ...] }`,
          },
          {
            label: 'String template',
            code: `engine.query([
  { op: 'map', transforms: [{
    field: 'email',
    expr: { type: 'template', template: '{name}@{department}.company.com' }
  }]}
]);
// => [{ ..., email: 'alice@engineering.company.com' }, ...]`,
          },
          {
            label: 'Multiple transforms',
            code: `engine.query([
  { op: 'map', transforms: [
    { field: 'bonus', expr: { type: 'arithmetic', op: '*',
        left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } },
    { field: 'tax',   expr: { type: 'arithmetic', op: '*',
        left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.3 } } },
    { field: 'email', expr: { type: 'template', template: '{name}@company.com' } }
  ]}
]);`,
          },
          {
            label: 'Nested arithmetic',
            code: `// net = salary - (salary * 0.3)
engine.query([
  { op: 'map', transforms: [{
    field: 'net',
    expr: { type: 'arithmetic', op: '-',
      left: { type: 'field', name: 'salary' },
      right: { type: 'arithmetic', op: '*',
        left:  { type: 'field',   name: 'salary' },
        right: { type: 'literal', value: 0.3     } } }
  }]}
]);`,
          },
        ],
      },
      {
        id: 'op-reduce',
        name: 'reduce',
        signature: '{ op: "reduce", field, reducer, [alias] }',
        returnType: 'terminal → number',
        since: '1.0.0',
        description:
          'Aggregates a numeric field over all (or previously filtered) rows. Terminal — cannot be chained further.',
        params: [
          { name: 'field', type: 'string', description: 'Numeric field to aggregate.' },
          {
            name: 'reducer',
            type: '"sum" | "avg" | "min" | "max" | "first" | "last"',
            description: 'Aggregation function.',
          },
          { name: '[alias]', type: 'string', description: 'Output key name (used inside groupBy aggregates).' },
        ],
        returns: '{ type: "number", value: number }',
        examples: [
          {
            code: `// Sum active salaries
engine.query([
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
  { op: 'reduce', field: 'salary', reducer: 'sum' }
]);
// => { type: 'number', value: 48302000 }

// Average salary across all rows
engine.query([{ op: 'reduce', field: 'salary', reducer: 'avg' }]);
// => { type: 'number', value: 74210 }

// Min / max
engine.query([{ op: 'reduce', field: 'salary', reducer: 'max' }]);
// => { type: 'number', value: 149999 }`,
          },
        ],
      },
      {
        id: 'op-group-by',
        name: 'groupBy',
        signature: '{ op: "groupBy", field, [aggregate] }',
        returnType: 'terminal',
        since: '1.0.0',
        description:
          'Groups rows by one or more fields. Without aggregate: returns array of group objects with rows attached. With aggregate: returns object keyed by group value with stats.',
        params: [
          {
            name: 'field',
            type: 'string | string[]',
            description: 'Field name or array of field names. Multi-field keys joined with "||".',
          },
          {
            name: '[aggregate]',
            type: 'ReduceOpInline[]',
            description:
              'Optional aggregations per group: [{ field, reducer, alias }]. Presence changes return type from array to object.',
          },
        ],
        returns: `Without aggregate: { type: 'array',  value: [{ _group, _count, [field], rows }] }
With aggregate:    { type: 'object', value: { groupKey: { _count, ...aliases } } }`,
        examples: [
          {
            label: 'Group by single field',
            code: `engine.query([{ op: 'groupBy', field: 'department' }]);
// => { type: 'array', value: [
//   { _group: 'engineering', _count: 420, department: 'engineering', rows: [...] },
//   { _group: 'marketing',   _count: 310, department: 'marketing',   rows: [...] },
// ]}`,
          },
          {
            label: 'GroupBy + aggregates',
            code: `engine.query([
  { op: 'groupBy', field: 'department',
    aggregate: [
      { field: 'salary', reducer: 'avg', alias: 'avg_salary' },
      { field: 'salary', reducer: 'max', alias: 'max_salary' }
    ]}
]);
// => { type: 'object', value: {
//   engineering: { _count: 420, avg_salary: 91200, max_salary: 149000 },
//   marketing:   { _count: 310, avg_salary: 74500, max_salary: 128000 },
// }}`,
          },
          {
            label: 'Multi-field groupBy',
            code: `engine.query([
  { op: 'groupBy', field: ['department', 'country'],
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] }
]);
// => { type: 'object', value: {
//   'engineering||US': { _count: 120, avg_salary: 94000 },
//   'engineering||UK': { _count: 85,  avg_salary: 87000 },
// }}`,
          },
        ],
      },
      {
        id: 'op-count',
        name: 'count',
        signature: '{ op: "count", [field] }',
        returnType: 'terminal → number',
        since: '1.0.0',
        description:
          'Counts rows. Without field: counts all rows in the current pipeline. With field: counts rows where that field is truthy.',
        params: [
          { name: '[field]', type: 'string', description: 'Optional field to count truthy values of.' },
        ],
        returns: '{ type: "number", value: number }',
        examples: [
          {
            code: `// Count filtered rows
engine.query([
  { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
  { op: 'count' }
]);
// => { type: 'number', value: 9600 }

// Count truthy values in a field
engine.query([{ op: 'count', field: 'active' }]);
// => { type: 'number', value: 66667 }`,
          },
        ],
      },
      {
        id: 'op-find',
        name: 'find',
        signature: '{ op: "find", conditions, [logic] }',
        returnType: 'terminal → item | null',
        since: '1.0.0',
        description:
          'Returns the first row matching all conditions, or null if none match. Stops scanning as soon as a match is found.',
        params: [
          { name: 'conditions', type: 'Condition[]', description: 'Same format as filter conditions.' },
          { name: '[logic]', type: '"and" | "or"', description: 'Condition logic. Default: "and".' },
        ],
        returns: '{ type: "item", value: Record<string, unknown> | null }',
        examples: [
          {
            code: `const result = engine.query([
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 42 }] }
]);
// => { type: 'item', value: { id: 42, name: 'Carol', salary: 97000, ... } }

// Multi-condition find
engine.query([
  { op: 'find', conditions: [
    { field: 'department', operator: 'eq',  value: 'engineering' },
    { field: 'salary',     operator: 'gte', value: 100000        }
  ]}
]);
// => { type: 'item', value: { id: 7, name: 'Evan', salary: 112000, ... } }

// Not found
engine.query([
  { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 99999 }] }
]);
// => { type: 'item', value: null }`,
          },
        ],
      },
    ],
  },
  {
    id: 'utilities',
    name: 'Utilities',
    methods: [
      {
        id: 'len',
        name: 'len',
        signature: 'engine.len()',
        returnType: 'number',
        since: '1.0.0',
        description: 'Returns the total number of rows in the dataset.',
        params: [],
        returns: 'number — row count.',
        examples: [{ code: `const engine = new RsJs(data);\nengine.len(); // => 100000` }],
      },
      {
        id: 'is-empty',
        name: 'is_empty',
        signature: 'engine.is_empty()',
        returnType: 'boolean',
        since: '1.0.0',
        description: 'Returns true if the dataset contains no rows.',
        params: [],
        returns: 'boolean.',
        examples: [
          {
            code: `const engine = new RsJs([]);
engine.is_empty(); // => true

const engine2 = new RsJs(data);
engine2.is_empty(); // => false`,
          },
        ],
      },
      {
        id: 'free',
        name: 'free',
        signature: 'engine.free()',
        returnType: 'void',
        since: '1.0.0',
        description:
          'Releases WASM linear memory. Must be called when you are done with the engine to prevent memory leaks. Any method call after free() will throw.',
        note: 'In long-running Node.js services, always call free() when a request or processing job completes.',
        params: [],
        returns: 'void.',
        examples: [
          {
            code: `const engine = new RsJs(data);

try {
  const result = engine.query([...]);
  process(result);
} finally {
  engine.free(); // always release — prevents WASM memory leaks
}`,
          },
        ],
      },
    ],
  },
];
