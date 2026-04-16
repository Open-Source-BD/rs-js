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

// ─── timing helper ────────────────────────────────────────────────────────────

function hrt() { return Number(process.hrtime.bigint()); }

function bench(label, jsFn, processFn, engineFn, runs = 5) {
    // warm-up
    jsFn(); processFn(); engineFn();

    const jsTimes = [], processTimes = [], engineTimes = [];

    for (let i = 0; i < runs; i++) {
        let t;
        t = hrt(); jsFn();       jsTimes.push(hrt() - t);
        t = hrt(); processFn();  processTimes.push(hrt() - t);
        t = hrt(); engineFn();   engineTimes.push(hrt() - t);
    }

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const ms  = ns => (ns / 1e6).toFixed(2);

    const jsAvg      = avg(jsTimes);
    const processAvg = avg(processTimes);
    const engineAvg  = avg(engineTimes);

    const engineRatio = jsAvg / engineAvg;
    const engineWinner = engineRatio >= 1
        ? `engine ${engineRatio.toFixed(1)}x faster`
        : `js     ${(1 / engineRatio).toFixed(1)}x faster`;

    console.log(
        `  ${label.padEnd(32)}` +
        `js: ${ms(jsAvg).padStart(8)} ms` +
        `   process(): ${ms(processAvg).padStart(8)} ms` +
        `   engine: ${ms(engineAvg).padStart(8)} ms` +
        `   → ${engineWinner}`
    );
}

// ─── pure-JS implementations ──────────────────────────────────────────────────

function jsFilter(data)  { return data.filter(r => r.age >= 18); }
function jsMap(data)     { return data.map(r => ({ ...r, bonus: r.salary * 0.1 })); }
function jsReduce(data)  { return data.filter(r => r.active).reduce((s, r) => s + r.salary, 0); }
function jsCount(data)   { return data.filter(r => r.age >= 18).length; }
function jsFind(data, id){ return data.find(r => r.id === id) ?? null; }

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

const mapOps = [
    {
        op: 'map',
        transforms: [{
            field: 'bonus',
            expr: { type: 'arithmetic', op: '*',
                left:  { type: 'field',   name: 'salary' },
                right: { type: 'literal', value: 0.1     } }
        }]
    }
];

const reduceOps = [
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
    { op: 'reduce', field: 'salary', reducer: 'sum' }
];

const countOps = [
    { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
    { op: 'count' }
];

const groupByOps = [
    { op: 'groupBy', field: 'department' }
];

const groupByAggOps = [
    {
        op: 'groupBy',
        field: 'country',
        aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }]
    }
];

const pipelineOps = [
    {
        op: 'filter',
        logic: 'and',
        conditions: [
            { field: 'active', operator: 'eq',  value: true },
            { field: 'age',    operator: 'gte', value: 18   }
        ]
    },
    {
        op: 'groupBy',
        field: 'department',
        aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }]
    }
];

// ─── run ──────────────────────────────────────────────────────────────────────

function run() {
    const SIZES = [10_000, 100_000, 500_000];

    for (const n of SIZES) {
        const data   = generateData(n);
        const findId = Math.floor(n / 2);

        // DataEngine: deserialize data once into WASM for this dataset size
        const engine = new DataEngine(data);

        console.log(`\n${'─'.repeat(110)}`);
        console.log(`  Dataset: ${n.toLocaleString()} rows   (engine loaded ${engine.len().toLocaleString()} rows into WASM)`);
        console.log(`${'─'.repeat(110)}`);

        bench('filter  (age >= 18)',
            () => jsFilter(data),
            () => rsProcess(data, filterOps),
            () => engine.query(filterOps));

        bench('map     (salary × 0.1)',
            () => jsMap(data),
            () => rsProcess(data, mapOps),
            () => engine.query(mapOps));

        bench('reduce  (sum active salaries)',
            () => jsReduce(data),
            () => rsProcess(data, reduceOps),
            () => engine.query(reduceOps));

        bench('count   (age >= 18)',
            () => jsCount(data),
            () => rsProcess(data, countOps),
            () => engine.query(countOps));

        bench('find    (by id)',
            () => jsFind(data, findId),
            () => rsProcess(data, [{ op: 'find', conditions: [{ field: 'id', operator: 'eq', value: findId }] }]),
            () => engine.query([{ op: 'find', conditions: [{ field: 'id', operator: 'eq', value: findId }] }]));

        bench('groupBy (by department)',
            () => jsGroupBy(data),
            () => rsProcess(data, groupByOps),
            () => engine.query(groupByOps));

        bench('groupBy + avg (by country)',
            () => jsGroupByAgg(data),
            () => rsProcess(data, groupByAggOps),
            () => engine.query(groupByAggOps));

        bench('pipeline (filter → groupBy + avg)',
            () => jsPipeline(data),
            () => rsProcess(data, pipelineOps),
            () => engine.query(pipelineOps));

        engine.free();
    }

    console.log(`\n${'─'.repeat(110)}`);
    console.log('  process(): re-serializes full dataset on every call (includes JS→WASM overhead).');
    console.log('  engine:    dataset loaded into WASM once; query() only crosses the ops array.');
    console.log(`${'─'.repeat(110)}\n`);
}

run();
