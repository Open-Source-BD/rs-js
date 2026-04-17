'use strict';
const { process: rsProcess, DataEngine } = require('./js/index.node.cjs');

// ─── dataset generator ────────────────────────────────────────────────────────

const DEPARTMENTS = ['engineering', 'marketing', 'design', 'sales', 'hr'];
const COUNTRIES   = ['US', 'UK', 'CA', 'AU', 'DE'];

function generateData(n) {
    return Array.from({ length: n }, (_, i) => ({
        id:         i + 1,
        name:       `User_${i}`,
        age:        16 + (i % 50),
        department: DEPARTMENTS[i % DEPARTMENTS.length],
        salary:     30000 + (i % 120000),
        country:    COUNTRIES[i % COUNTRIES.length],
        active:     i % 5 !== 0,
        score:      parseFloat(((i % 100) / 100).toFixed(2)),
    }));
}

// ─── timing ───────────────────────────────────────────────────────────────────

function hrt() { return Number(process.hrtime.bigint()); }

function fmtMs(ns) { return (ns / 1e6).toFixed(2) + ' ms'; }

function bench(label, fns, col4name = null, runs = 5) {
    for (const fn of fns) fn();            // warm-up

    const times = fns.map(() => []);
    for (let i = 0; i < runs; i++)
        for (let j = 0; j < fns.length; j++) {
            const t = hrt(); fns[j](); times[j].push(hrt() - t);
        }

    const avg  = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const avgs = times.map(avg);
    const jsAvg = avgs[0];

    const best = avgs.slice(2).reduce(
        (b, v, i) => v < b.v ? { v, i: i + 2 } : b,
        { v: jsAvg, i: 0 }
    );
    const names  = ['js', 'process()', 'engine', col4name];
    const winner = best.i === 0
        ? 'js wins'
        : `${names[best.i]} ${(jsAvg / best.v).toFixed(1)}x faster than js`;

    return { label, avgs, col4name, winner };
}

// ─── table printer ────────────────────────────────────────────────────────────

function printSection(n, rows) {
    const WO = 36, WT = 10, WA = 22, WW = 33;
    const R = (s, w) => String(s).padStart(w);
    const L = (s, w) => String(s).padEnd(w);

    const hline = (tl, jn, tr, f) =>
        `${tl}${f.repeat(WO + 2)}${jn}${f.repeat(WT + 2)}${jn}${f.repeat(WT + 2)}${jn}${f.repeat(WT + 2)}${jn}${f.repeat(WA + 2)}${jn}${f.repeat(WW + 2)}${tr}`;

    const dataRow = (op, js, pr, en, alt, wi) =>
        `│ ${L(op, WO)} │ ${R(js, WT)} │ ${R(pr, WT)} │ ${R(en, WT)} │ ${R(alt, WA)} │ ${L(wi, WW)} │`;

    const headRow = () =>
        `│ ${L('Operation', WO)} │ ${L('js', WT)} │ ${L('process()', WT)} │ ${L('engine', WT)} │ ${L('fast path', WA)} │ ${L('Winner', WW)} │`;

    console.log(`\n  Dataset: ${n.toLocaleString()} rows\n`);
    console.log(hline('┌', '┬', '┐', '─'));
    console.log(headRow());
    console.log(hline('├', '┼', '┤', '─'));

    for (const { label, avgs, col4name, winner } of rows) {
        const alt = avgs[3] !== undefined
            ? `${col4name}: ${fmtMs(avgs[3])}`
            : '—';
        console.log(dataRow(
            label,
            fmtMs(avgs[0]),
            fmtMs(avgs[1]),
            fmtMs(avgs[2]),
            alt,
            winner,
        ));
    }

    console.log(hline('└', '┴', '┘', '─'));
}

// ─── pure-JS implementations ──────────────────────────────────────────────────

function jsFilter(data)   { return data.filter(r => r.age >= 18); }
function jsMap(data)      { return data.map(r => ({ ...r, bonus: r.salary * 0.1 })); }
function jsReduce(data)   { return data.filter(r => r.active).reduce((s, r) => s + r.salary, 0); }
function jsCount(data)    { return data.filter(r => r.age >= 18).length; }
function jsFind(data, id) { return data.find(r => r.id === id) ?? null; }

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
    const filtered = data.filter(r => r.active && r.age >= 18);
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

// ─── operation descriptors ────────────────────────────────────────────────────

const filterOps = [
    { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }
];
const mapOps = [{
    op: 'map',
    transforms: [{
        field: 'bonus',
        expr: { type: 'arithmetic', op: '*',
            left:  { type: 'field',   name: 'salary' },
            right: { type: 'literal', value: 0.1 } }
    }]
}];
const reduceOps = [
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
    { op: 'reduce', field: 'salary', reducer: 'sum' }
];
const countOps = [
    { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
    { op: 'count' }
];
const groupByOps    = [{ op: 'groupBy', field: 'department' }];
const groupByAggOps = [{
    op: 'groupBy', field: 'country',
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }]
}];
const pipelineOps = [
    { op: 'filter', logic: 'and', conditions: [
        { field: 'active', operator: 'eq',  value: true },
        { field: 'age',    operator: 'gte', value: 18   }
    ]},
    { op: 'groupBy', field: 'department',
      aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] }
];

// ─── run ──────────────────────────────────────────────────────────────────────

function run() {
    const SIZES = [10_000, 100_000, 500_000];

    for (const n of SIZES) {
        const data   = generateData(n);
        const findId = Math.floor(n / 2);
        const engine = new DataEngine(data);
        const rows   = [];

        rows.push(bench('filter  (age >= 18)', [
            () => jsFilter(data),
            () => rsProcess(data, filterOps),
            () => engine.query(filterOps),
            () => { const idx = engine.filterIndices(filterOps); const m = idx.length; const out = new Array(m); for (let i = 0; i < m; i++) out[i] = data[idx[i]]; return out; },
        ], 'filterIdx'));

        rows.push(bench('map     (salary × 0.1)', [
            () => jsMap(data),
            () => rsProcess(data, mapOps),
            () => engine.query(mapOps),
        ]));

        rows.push(bench('reduce  (sum active salaries)', [
            () => jsReduce(data),
            () => rsProcess(data, reduceOps),
            () => engine.query(reduceOps),
        ]));

        rows.push(bench('count   (age >= 18)', [
            () => jsCount(data),
            () => rsProcess(data, countOps),
            () => engine.query(countOps),
        ]));

        rows.push(bench('find    (by id)', [
            () => jsFind(data, findId),
            () => rsProcess(data, [{ op: 'find', conditions: [{ field: 'id', operator: 'eq', value: findId }] }]),
            () => engine.query([{ op: 'find', conditions: [{ field: 'id', operator: 'eq', value: findId }] }]),
        ]));

        rows.push(bench('groupBy (by department)', [
            () => jsGroupBy(data),
            () => rsProcess(data, groupByOps),
            () => engine.query(groupByOps),
        ]));

        rows.push(bench('groupBy + avg (by country)', [
            () => jsGroupByAgg(data),
            () => rsProcess(data, groupByAggOps),
            () => engine.query(groupByAggOps),
        ]));

        rows.push(bench('pipeline (filter → groupBy + avg)', [
            () => jsPipeline(data),
            () => rsProcess(data, pipelineOps),
            () => engine.query(pipelineOps),
        ]));

        rows.push(bench('filterView  (columnar, age >= 18)', [
            () => jsFilter(data),
            () => rsProcess(data, filterOps),
            () => engine.query(filterOps),
            () => engine.filterView(filterOps),
        ], 'filterView'));

        rows.push(bench('mapField    (bonus col only)', [
            () => jsMap(data),
            () => rsProcess(data, mapOps),
            () => engine.query(mapOps),
            () => engine.mapField(mapOps),
        ], 'mapField'));

        rows.push(bench('groupByIdx  (by department)', [
            () => jsGroupBy(data),
            () => rsProcess(data, groupByOps),
            () => engine.query(groupByOps),
            () => {
                const idx = engine.groupByIndices('department');
                const r = {};
                for (const [k, v] of Object.entries(idx)) {
                    const m = v.length; const gr = new Array(m);
                    for (let i = 0; i < m; i++) gr[i] = data[v[i]];
                    r[k] = gr;
                }
                return r;
            },
        ], 'groupByIdx'));

        printSection(n, rows);
        engine.free();
    }

    console.log('\n  Notes:');
    console.log('  · fast path = typed-array API — no per-row object serialization.');
    console.log('  · engine (filter/map/groupBy rows) = serde wall — WASM must serialize N row objects.');
    console.log('  · process() = row-based + full dataset deserialized on every call.\n');
}

run();
