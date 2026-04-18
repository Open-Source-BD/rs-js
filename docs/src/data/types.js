export const types = [
  {
    id: 'type-operator',
    name: 'Operator',
    kind: 'type alias',
    description:
      'All supported filter condition operators. Used in Condition objects inside filter and find operations.',
    usedBy: ['Condition', 'filter op', 'find op'],
    definition: `type Operator =
  | 'eq'          // ===
  | 'ne'          // !==
  | 'gt'          // >
  | 'gte'         // >=
  | 'lt'          // <
  | 'lte'         // <=
  | 'contains'    // string.includes(value)
  | 'startsWith'  // string.startsWith(value)
  | 'endsWith'    // string.endsWith(value)
  | 'in'          // value in array
  | 'notIn'       // value not in array
  | 'isNull'      // value == null
  | 'isNotNull';  // value != null`,
    example: `{ field: 'age',        operator: 'gte',       value: 18 }
{ field: 'name',       operator: 'startsWith', value: 'A' }
{ field: 'department', operator: 'in',         value: ['engineering', 'design'] }
{ field: 'email',      operator: 'isNotNull',  value: undefined }`,
  },
  {
    id: 'type-condition',
    name: 'Condition',
    kind: 'interface',
    description: 'A single filter predicate. Conditions are combined with ConditionLogic inside filter and find operations.',
    usedBy: ['filter op', 'find op'],
    definition: `interface Condition {
  field:    string;    // row field name to test
  operator: Operator;  // comparison operator
  value:    unknown;   // right-hand operand (ignored for isNull / isNotNull)
}`,
    example: `const ageCheck: Condition = {
  field:    'age',
  operator: 'gte',
  value:    18,
};

const inList: Condition = {
  field:    'department',
  operator: 'in',
  value:    ['engineering', 'design'],
};`,
  },
  {
    id: 'type-condition-logic',
    name: 'ConditionLogic',
    kind: 'type alias',
    description: 'Controls how multiple conditions are combined inside a filter or find operation. Defaults to "and" when omitted.',
    usedBy: ['filter op', 'find op'],
    definition: `type ConditionLogic = 'and' | 'or';`,
    example: `// AND (default) — row must pass all conditions
{ op: 'filter', conditions: [...], logic: 'and' }

// OR — row passes if any condition matches
{ op: 'filter', conditions: [...], logic: 'or' }`,
  },
  {
    id: 'type-map-expr',
    name: 'MapExpr',
    kind: 'type alias',
    description: 'Expression tree for computing new field values in map transforms. Composes into arbitrarily deep arithmetic trees.',
    usedBy: ['map op', 'filterMapRef', 'mapRef'],
    definition: `type MapExpr =
  | { type: 'literal';    value: unknown }
  | { type: 'field';      name: string }
  | { type: 'template';   template: string }         // '{name}@company.com'
  | { type: 'arithmetic'; op: '+' | '-' | '*' | '/';
      left: MapExpr; right: MapExpr };`,
    example: `// Literal value
{ type: 'literal', value: 42 }

// Field reference
{ type: 'field', name: 'salary' }

// String template — {fieldName} placeholders
{ type: 'template', template: '{name}@{department}.company.com' }

// Arithmetic — field * literal
{ type: 'arithmetic', op: '*',
  left:  { type: 'field',   name: 'salary' },
  right: { type: 'literal', value: 0.1     } }

// Nested arithmetic — (salary - (salary * 0.3))
{ type: 'arithmetic', op: '-',
  left: { type: 'field', name: 'salary' },
  right: { type: 'arithmetic', op: '*',
    left:  { type: 'field',   name: 'salary' },
    right: { type: 'literal', value: 0.3     } } }`,
  },
  {
    id: 'type-reduce-op-inline',
    name: 'ReduceOpInline',
    kind: 'interface',
    description: 'Aggregation spec used inside a groupBy operation. Each entry produces one aggregate field per group.',
    usedBy: ['groupBy op'],
    definition: `interface ReduceOpInline {
  field:   string;                                       // field to aggregate
  reducer: 'sum' | 'avg' | 'min' | 'max' | 'first' | 'last';
  alias?:  string;                                       // output key name
}`,
    example: `{ op: 'groupBy', field: 'department',
  aggregate: [
    { field: 'salary', reducer: 'avg', alias: 'avg_salary' },
    { field: 'salary', reducer: 'max', alias: 'max_salary' },
    { field: 'age',    reducer: 'min', alias: 'youngest'   },
  ]
}
// => { engineering: { _count: 420, avg_salary: 91200, max_salary: 149000, youngest: 21 } }`,
  },
  {
    id: 'type-operation',
    name: 'Operation',
    kind: 'type alias',
    description:
      'Discriminated union of all supported operations. The "op" field is the discriminant. Intermediate ops (filter, map) can be chained; terminal ops (reduce, groupBy, count, find) end the pipeline.',
    usedBy: ['query', 'filterIndices', 'filterViewRef', 'mapRef', 'filterMapRef'],
    definition: `type Operation =
  | { op: 'filter';  conditions: Condition[];         logic?: ConditionLogic }
  | { op: 'map';     transforms: Array<{ field: string; expr: MapExpr }> }
  | { op: 'reduce';  field: string;                   reducer: 'sum'|'avg'|'min'|'max'|'first'|'last'; alias?: string }
  | { op: 'groupBy'; field: string | string[];        aggregate?: ReduceOpInline[] }
  | { op: 'count';   field?: string }
  | { op: 'find';    conditions: Condition[];         logic?: ConditionLogic };`,
    example: `const filterOp:  Operation = { op: 'filter',  conditions: [{ field: 'active', operator: 'eq', value: true }] };
const mapOp:     Operation = { op: 'map',     transforms: [{ field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] };
const reduceOp:  Operation = { op: 'reduce',  field: 'salary', reducer: 'sum' };
const groupByOp: Operation = { op: 'groupBy', field: 'department', aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] };
const countOp:   Operation = { op: 'count' };
const findOp:    Operation = { op: 'find',    conditions: [{ field: 'id', operator: 'eq', value: 42 }] };`,
  },
  {
    id: 'type-pipeline-options',
    name: 'PipelineOptions',
    kind: 'interface',
    description: 'Optional windowing applied to the dataset before operations execute. offset + limit slice the input rows, not the output.',
    usedBy: ['query', 'filterIndices', 'filterViewRef', 'mapRef', 'filterMapRef'],
    definition: `interface PipelineOptions {
  limit?:       number;   // max rows to process
  offset?:      number;   // skip first N rows
  includeMeta?: boolean;  // attach metadata to result (reserved)
}`,
    example: `// Process rows 1000–1019 only
engine.query(ops, { offset: 1000, limit: 20 });

// First 500 rows
engine.query(ops, { limit: 500 });`,
  },
  {
    id: 'type-pipeline-result',
    name: 'PipelineResult',
    kind: 'type alias',
    description:
      'Return type of engine.query(). Always check result.type before reading result.value — the union has four distinct shapes.',
    usedBy: ['query'],
    definition: `type PipelineResult =
  | { type: 'array';  value: Record<string, unknown>[] }
  | { type: 'number'; value: number }
  | { type: 'object'; value: Record<string, Record<string, unknown>> }
  | { type: 'item';   value: Record<string, unknown> | null };`,
    example: `const result = engine.query(ops);

if (result.type === 'array') {
  result.value.forEach(row => console.log(row));       // filter, map, groupBy (no agg)
} else if (result.type === 'number') {
  console.log(result.value);                           // reduce, count
} else if (result.type === 'object') {
  Object.entries(result.value).forEach(([k, v]) => console.log(k, v)); // groupBy + agg
} else if (result.type === 'item') {
  console.log(result.value ?? 'not found');            // find
}`,
  },
  {
    id: 'type-str-column-view',
    name: 'StrColumnView',
    kind: 'interface',
    description:
      'Categorical encoding for string columns in zero-copy APIs. Codes array has one entry per matched row; each code is an index into the categories array. Avoids materializing repeated string values.',
    usedBy: ['FilterSelectionRef', 'FilterMapRef', 'MapRefView'],
    definition: `interface StrColumnView {
  codes:      Uint16Array;  // per-row category index (0-based)
  categories: string[];     // unique values (low-cardinality)
}`,
    example: `engine.filterViewRef([filterOp], (ref) => {
  const { codes, categories } = ref.columns.department;
  // categories = ['engineering', 'marketing', 'sales', 'hr', 'design']
  // codes[i]   = 0 means row i is in 'engineering'

  const deptStats = {};
  for (let i = 0; i < ref.indices.length; i++) {
    const dept = categories[codes[i]];      // O(1) lookup, no string comparison
    (deptStats[dept] ??= 0)++;
  }
});`,
  },
  {
    id: 'type-column-view',
    name: 'ColumnView',
    kind: 'type alias',
    description: 'Union of all column representations used in zero-copy filter APIs. The concrete type depends on the source column\'s data type.',
    usedBy: ['FilterView', 'FilterSelectionRef'],
    definition: `type ColumnView =
  | Float64Array    // numeric fields (f64; NaN = null/missing)
  | Uint8Array      // boolean fields (0 = false, 1 = true, 255 = null)
  | StrColumnView;  // string fields (categorical encoding)`,
    example: `engine.filterViewRef([filterOp], (ref) => {
  const salary = ref.columns.salary;     // Float64Array — numeric
  const active = ref.columns.active;     // Uint8Array   — boolean
  const dept   = ref.columns.department; // StrColumnView — string

  for (let i = 0; i < ref.indices.length; i++) {
    const isActive = active[i] === 1;
    const deptName = dept.categories[dept.codes[i]];
    const sal      = salary[i];           // NaN if null/missing
  }
});`,
  },
  {
    id: 'type-filter-selection-ref',
    name: 'FilterSelectionRef',
    kind: 'interface',
    description:
      'Callback argument for filterViewRef. Contains sparse indices (which rows matched) and per-column window views into WASM memory. Views are valid only inside the callback.',
    usedBy: ['filterViewRef'],
    definition: `interface FilterSelectionRef {
  indices: Uint32Array;  // matched row indices into original dataset
  columns: FilterView;   // { [fieldName]: ColumnView } — window into WASM memory
}

// FilterView
interface FilterView {
  [field: string]: ColumnView;
}`,
    example: `engine.filterViewRef(
  [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
  (ref: FilterSelectionRef) => {
    console.log(ref.indices.length);           // matched row count
    console.log(ref.columns.salary[0]);        // salary of first match (Float64Array)
    console.log(ref.columns.active[0]);        // 1 = true (Uint8Array)
    // ref.columns.* views become invalid after callback returns
  }
);`,
  },
  {
    id: 'type-filter-map-ref',
    name: 'FilterMapRef',
    kind: 'interface',
    description:
      'Callback argument for filterMapRef. Columns are GATHERED — compacted to the matched rows only (position 0..count). Unlike FilterSelectionRef, no index indirection needed. All views are zero-copy into WASM memory, valid only inside the callback.',
    usedBy: ['filterMapRef'],
    definition: `interface FilterMapRef {
  count:   number;       // number of rows that matched the filter
  indices: Uint32Array;  // absolute row indices into original dataset
  columns: Record<string, Float64Array | Uint8Array | StrColumnView>;
  // All original columns gathered to matched rows, plus computed transform columns.
  // Float64Array for numeric; Uint8Array for bool; StrColumnView for string.
}`,
    example: `engine.filterMapRef(filterOps, mapOps, (ref: FilterMapRef) => {
  ref.count                            // => 96000
  ref.indices                          // Uint32Array [2, 3, 4, ...]
  ref.columns.salary                   // Float64Array — original numeric col, gathered
  ref.columns.active                   // Uint8Array   — original bool col, gathered
  ref.columns.department               // StrColumnView — original str col, gathered
  ref.columns.bonus                    // Float64Array — computed by map transform

  // Direct loop — no index lookup needed
  for (let i = 0; i < ref.count; i++) {
    const bonus = ref.columns.bonus[i];     // row i of gathered result
    const dept  = ref.columns.department.categories[ref.columns.department.codes[i]];
  }
});`,
  },
  {
    id: 'type-map-ref-view',
    name: 'MapRefView',
    kind: 'interface',
    description:
      'Callback argument for mapRef. Keys are the transform field names. Field projections (type: "field") return zero-copy typed array subarrays into WASM memory. Arithmetic transforms return a new Float64Array on the JS heap. String templates return JS string arrays.',
    usedBy: ['mapRef'],
    definition: `interface MapRefView {
  [field: string]:
    | Float64Array   // arithmetic / numeric literal / field projection (numeric)
    | Uint8Array     // field projection (bool)
    | Uint16Array    // field projection (str codes)
    | StrColumnView  // field projection (full str column)
    | unknown[];     // template / string literal → JS string array
}`,
    example: `engine.mapRef(
  [{ op: 'map', transforms: [
    { field: 'bonus',      expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } },
    { field: 'salary_raw', expr: { type: 'field',      name: 'salary' } },                                // zero-copy subarray
    { field: 'label',      expr: { type: 'template',   template: '{name} ({department})' } }             // string[]
  ]}],
  (ref: MapRefView) => {
    ref.bonus;      // Float64Array (computed, new allocation on JS heap)
    ref.salary_raw; // Float64Array (zero-copy subarray into WASM memory)
    ref.label;      // string[]
  }
);`,
  },
  {
    id: 'type-rs-js-options',
    name: 'RsJsOptions',
    kind: 'interface',
    description:
      'Constructor options controlling at which dataset sizes the engine switches from the JS fast path to the WASM engine. Tune these when default crossover points do not match your hardware or dataset shape.',
    usedBy: ['new RsJs', 'createRsJs'],
    definition: `interface RsJsOptions {
  smallRowThreshold?: number;  // overrides all three thresholds below (backwards compat)
  filterThreshold?:   number;  // JS path below this row count  (default: 15,000)
  mapThreshold?:      number;  // JS path below this row count  (default: MAX_SAFE_INTEGER)
  groupByThreshold?:  number;  // JS path below this row count  (default: 30,000)
}`,
    example: `// Default thresholds (tuned from benchmarks)
new RsJs(data);

// Aggressive WASM — always use engine
new RsJs(data, { smallRowThreshold: 0 });

// Per-op tuning
new RsJs(data, {
  filterThreshold:   5_000,   // use WASM for filter at 5k+ rows
  groupByThreshold: 20_000,   // use WASM for groupBy at 20k+ rows
  // mapThreshold left at MAX_SAFE_INTEGER (JS always faster for row-object map)
});`,
  },
];
