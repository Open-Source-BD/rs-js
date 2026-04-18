"use strict";
const { DataEngine } = require("./js/index.node.cjs");

// ─── dataset generator ────────────────────────────────────────────────────────

const DEPARTMENTS = ["engineering", "marketing", "design", "sales", "hr"];
const COUNTRIES = ["US", "UK", "CA", "AU", "DE"];

function generateData(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `User_${i}`,
    age: 16 + (i % 50),
    department: DEPARTMENTS[i % DEPARTMENTS.length],
    salary: 30000 + (i % 120000),
    country: COUNTRIES[i % COUNTRIES.length],
    active: i % 5 !== 0,
    score: parseFloat(((i % 100) / 100).toFixed(2)),
  }));
}

// ─── timing ───────────────────────────────────────────────────────────────────

function hrt() {
  return Number(process.hrtime.bigint());
}

function fmtMs(ns) {
  return (ns / 1e6).toFixed(2) + " ms";
}

function bench(label, fns, runs = 5) {
  for (const fn of fns) fn(); // warm-up

  const times = fns.map(() => []);
  for (let i = 0; i < runs; i++) {
    for (let j = 0; j < fns.length; j++) {
      const t = hrt();
      fns[j]();
      times[j].push(hrt() - t);
    }
  }

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const avgs = times.map(avg);
  const jsAvg = avgs[0];
  const engineAvg = Math.min(...avgs.slice(1));

  const winner =
    engineAvg < jsAvg
      ? `engine ${(jsAvg / engineAvg).toFixed(1)}x faster than js`
      : "js wins";

  return { label, jsAvg, engineAvg, winner };
}

// ─── table printer ────────────────────────────────────────────────────────────

function printSection(n, rows) {
  const WO = 36,
    WT = 10,
    WW = 33;
  const R = (s, w) => String(s).padStart(w);
  const L = (s, w) => String(s).padEnd(w);

  const hline = (tl, jn, tr, f) =>
    `${tl}${f.repeat(WO + 2)}${jn}${f.repeat(WT + 2)}${jn}${f.repeat(WT + 2)}${jn}${f.repeat(WW + 2)}${tr}`;

  const dataRow = (op, js, en, wi) =>
    `│ ${L(op, WO)} │ ${R(js, WT)} │ ${R(en, WT)} │ ${L(wi, WW)} │`;

  const headRow = () =>
    `│ ${L("Operation", WO)} │ ${L("js", WT)} │ ${L("engine", WT)} │ ${L("Winner", WW)} │`;

  console.log(`\n  Dataset: ${n.toLocaleString()} rows\n`);
  console.log(hline("┌", "┬", "┐", "─"));
  console.log(headRow());
  console.log(hline("├", "┼", "┤", "─"));

  for (const { label, jsAvg, engineAvg, winner } of rows) {
    console.log(dataRow(label, fmtMs(jsAvg), fmtMs(engineAvg), winner));
  }

  console.log(hline("└", "┴", "┘", "─"));
}

// ─── pure-JS implementations ──────────────────────────────────────────────────

function jsFilter(data) {
  return data.filter((r) => r.age >= 18);
}
function jsMap(data) {
  return data.map((r) => ({ ...r, bonus: r.salary * 0.1 }));
}
function jsMapProjection(data) {
  return data.map((r) => ({ salary_view: r.salary }));
}
function jsReduce(data) {
  return data.filter((r) => r.active).reduce((s, r) => s + r.salary, 0);
}
function jsCount(data) {
  return data.filter((r) => r.age >= 18).length;
}
function jsFind(data, id) {
  return data.find((r) => r.id === id) ?? null;
}

function jsGroupBy(data) {
  return data.reduce((acc, r) => {
    (acc[r.department] ??= []).push(r);
    return acc;
  }, {});
}

function jsGroupByAgg(data) {
  const groups = {};
  for (const r of data) {
    const g = (groups[r.country] ??= { _count: 0, _sum: 0 });
    g._count++;
    g._sum += r.salary;
  }
  for (const k of Object.keys(groups)) {
    groups[k].avg_salary = groups[k]._sum / groups[k]._count;
    delete groups[k]._sum;
  }
  return groups;
}

function jsPipeline(data) {
  const filtered = data.filter((r) => r.active && r.age >= 18);
  const groups = {};
  for (const r of filtered) {
    const g = (groups[r.department] ??= { _count: 0, _sum: 0 });
    g._count++;
    g._sum += r.salary;
  }
  for (const k of Object.keys(groups)) {
    groups[k].avg_salary = groups[k]._sum / groups[k]._count;
    delete groups[k]._sum;
  }
  return groups;
}

function jsFilterMap(data) {
  return data
    .filter((r) => r.age >= 18)
    .map((r) => ({ ...r, bonus: r.salary * 0.1 }));
}

// ─── columnar JS reference functions (apples-to-apples vs zero-copy WASM) ────
// These produce the same output *shape* as their WASM counterparts so the
// comparison is fair: typed arrays out vs typed arrays out.

// Same 8 fields the WASM engine extracts (numeric + bool + string categoricals).
const NUMERIC_FIELDS = ["id", "age", "salary", "score"];
const STRING_FIELDS = ["name", "department", "country"];

function jsColumnarFilter(data) {
  const indices = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i].age >= 18) indices.push(i);
  }
  const m = indices.length;
  const out = {};
  // Numeric → Float64Array
  for (const f of NUMERIC_FIELDS) {
    const arr = new Float64Array(m);
    for (let j = 0; j < m; j++) arr[j] = data[indices[j]][f];
    out[f] = arr;
  }
  // Boolean → Uint8Array
  const actArr = new Uint8Array(m);
  for (let j = 0; j < m; j++) actArr[j] = data[indices[j]].active ? 1 : 0;
  out.active = actArr;
  // String categoricals → {codes: Uint16Array, categories: string[]}
  for (const f of STRING_FIELDS) {
    const catMap = new Map();
    const codes = new Uint16Array(m);
    for (let j = 0; j < m; j++) {
      const v = data[indices[j]][f] ?? "null";
      let code = catMap.get(v);
      if (code === undefined) {
        code = catMap.size;
        catMap.set(v, code);
      }
      codes[j] = code;
    }
    out[f] = { codes, categories: [...catMap.keys()] };
  }
  return out;
}

function jsColumnarProject(data) {
  const arr = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) arr[i] = data[i].salary;
  return { salary_view: arr };
}

function jsGroupByIdxJs(data) {
  const groups = {};
  for (let i = 0; i < data.length; i++) {
    const key = data[i].department ?? "null";
    (groups[key] ??= []).push(i);
  }
  return groups;
}

// ─── operation descriptors ────────────────────────────────────────────────────

const filterOps = [
  { op: "filter", conditions: [{ field: "age", operator: "gte", value: 18 }] },
];
const mapOps = [
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
];
const reduceOps = [
  {
    op: "filter",
    conditions: [{ field: "active", operator: "eq", value: true }],
  },
  { op: "reduce", field: "salary", reducer: "sum" },
];
const countOps = [
  { op: "filter", conditions: [{ field: "age", operator: "gte", value: 18 }] },
  { op: "count" },
];
const groupByOps = [{ op: "groupBy", field: "department" }];
const groupByAggOps = [
  {
    op: "groupBy",
    field: "country",
    aggregate: [{ field: "salary", reducer: "avg", alias: "avg_salary" }],
  },
];
const pipelineOps = [
  {
    op: "filter",
    logic: "and",
    conditions: [
      { field: "active", operator: "eq", value: true },
      { field: "age", operator: "gte", value: 18 },
    ],
  },
  {
    op: "groupBy",
    field: "department",
    aggregate: [{ field: "salary", reducer: "avg", alias: "avg_salary" }],
  },
];

// ─── run ──────────────────────────────────────────────────────────────────────

function run() {
  const SIZES = process.env.BENCH_SIZES
    ? process.env.BENCH_SIZES.split(",")
        .map((s) => Number(s.trim()))
        .filter(Number.isFinite)
    : [10_000, 100_000, 500_000];

  for (const n of SIZES) {
    const data = generateData(n);
    const findId = Math.floor(n / 2);
    const engine = new DataEngine(data);
    const rows = [];

    rows.push(
      bench("filter  (age >= 18)", [
        () => jsFilter(data),
        () => engine.query(filterOps),
      ]),
    );

    rows.push(
      bench("map     (salary × 0.1)", [
        () => jsMap(data),
        () => engine.query(mapOps),
      ]),
    );

    rows.push(
      bench("mapRef      (salary × 0.1)", [
        () => jsMap(data),
        () => engine.mapRef(mapOps, (ref) => ref),
      ]),
    );

    rows.push(
      bench("reduce  (sum active salaries)", [
        () => jsReduce(data),
        () => engine.query(reduceOps),
      ]),
    );

    rows.push(
      bench("count   (age >= 18)", [
        () => jsCount(data),
        () => engine.query(countOps),
      ]),
    );

    rows.push(
      bench("find    (by id)", [
        () => jsFind(data, findId),
        () =>
          engine.query([
            {
              op: "find",
              conditions: [{ field: "id", operator: "eq", value: findId }],
            },
          ]),
      ]),
    );

    rows.push(
      bench("groupBy (by department)", [
        () => jsGroupBy(data),
        () => engine.query(groupByOps),
      ]),
    );

    rows.push(
      bench("groupBy + avg (by country)", [
        () => jsGroupByAgg(data),
        () => engine.query(groupByAggOps),
      ]),
    );

    rows.push(
      bench("pipeline (filter → groupBy + avg)", [
        () => jsPipeline(data),
        () => engine.query(pipelineOps),
      ]),
    );

    rows.push(
      bench("pipeline (filter → map + bonus)", [
        () => jsFilterMap(data),
        () => engine.query([...filterOps, ...mapOps]),
      ]),
    );

    rows.push(
      bench("filterViewRef (zero-copy)", [
        () => jsColumnarFilter(data),
        () => engine.filterViewRef(filterOps, (ref) => ref),
      ]),
    );

    rows.push(
      bench("mapRef      (salary projection)", [
        () => jsColumnarProject(data),
        () =>
          engine.mapRef(
            [
              {
                op: "map",
                transforms: [
                  {
                    field: "salary_view",
                    expr: { type: "field", name: "salary" },
                  },
                ],
              },
            ],
            (ref) => ref,
          ),
      ]),
    );

    rows.push(
      bench("groupByIdx  (by department)", [
        () => jsGroupByIdxJs(data),
        () => engine.groupByIndices("department"),
      ]),
    );

    printSection(n, rows);
    engine.free();
  }

  console.log("\n  Notes:");
  console.log("  · engine = single unified high-performance engine");
  console.log(
    "  · automatic caching provides prepared query performance with no extra boilerplate.\n",
  );
}

run();
