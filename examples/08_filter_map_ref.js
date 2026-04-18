'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/08_filter_map_ref.js

const { RsJs } = require('../js/index.node.cjs');

function generateData(n) {
    return Array.from({ length: n }, (_, i) => ({
        id:         i + 1,
        name:       'User_' + i,
        age:        16 + (i % 50),
        department: ['engineering', 'marketing', 'sales', 'hr', 'design'][i % 5],
        salary:     30000 + (i % 120000),
        active:     i % 3 !== 0,
    }));
}

const data = generateData(100_000);
const rsjs = new RsJs(data);

const filterOps = [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }];
const mapOps    = [{
    op: 'map',
    transforms: [
        { field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } },
        { field: 'email', expr: { type: 'template', template: '{name}@company.com' } },
    ],
}];

console.log('--- filterMapRef demo (100k rows, filter age>=18, compute bonus + email) ---\n');

// --- 1. Basic usage: aggregate inside callback ---
rsjs.filterMapRef(filterOps, mapOps, (ref) => {
    console.log(`Matched rows: ${ref.count}`);
    console.log(`Indices type: ${ref.indices.constructor.name}, length: ${ref.indices.length}`);
    console.log(`salary col:   ${ref.columns.salary.constructor.name}, length: ${ref.columns.salary.length}`);
    console.log(`bonus col:    ${ref.columns.bonus.constructor.name}, length: ${ref.columns.bonus.length}`);
    console.log(`dept col:     { codes: ${ref.columns.department.codes.constructor.name}, categories: ${ref.columns.department.categories.slice(0, 3).join(', ')}... }`);

    // Aggregate without creating any row objects
    let totalBonus = 0, maxSalary = 0, count = 0;
    const bonus = ref.columns.bonus;
    const salary = ref.columns.salary;
    for (let i = 0; i < ref.count; i++) {
        totalBonus += bonus[i];
        if (salary[i] > maxSalary) maxSalary = salary[i];
        count++;
    }
    console.log(`\nTotal bonus payout: $${totalBonus.toLocaleString()}`);
    console.log(`Max salary:         $${maxSalary.toLocaleString()}`);
    console.log(`Adult employee count: ${count}`);
});

// --- 2. Per-department bonus stats (using department codes) ---
console.log('\n--- Per-department stats (columnar, no row objects) ---');
rsjs.filterMapRef(
    [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
    [{ op: 'map', transforms: [{ field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] }],
    (ref) => {
        const { codes, categories } = ref.columns.department;
        const bonus = ref.columns.bonus;
        const deptStats = {};
        for (const cat of categories) deptStats[cat] = { count: 0, totalBonus: 0 };

        for (let i = 0; i < ref.count; i++) {
            const dept = categories[codes[i]];
            deptStats[dept].count++;
            deptStats[dept].totalBonus += bonus[i];
        }

        for (const [dept, s] of Object.entries(deptStats)) {
            if (s.count === 0) continue;
            const avg = (s.totalBonus / s.count).toFixed(0);
            console.log(`  ${dept.padEnd(12)}: ${s.count} employees, avg bonus $${Number(avg).toLocaleString()}`);
        }
    }
);

// --- 3. Performance comparison ---
console.log('\n--- Performance: filterMapRef vs query() row objects ---');

const RUNS = 5;
function hrt() { return Number(process.hrtime.bigint()); }

// Warm up
rsjs.filterMapRef(filterOps, mapOps, (ref) => ref.count);
rsjs.query([...filterOps, ...mapOps]);

let fmrTotal = 0, qTotal = 0;
for (let i = 0; i < RUNS; i++) {
    let t = hrt();
    rsjs.filterMapRef(filterOps, mapOps, (ref) => ref.count);
    fmrTotal += hrt() - t;

    t = hrt();
    rsjs.query([...filterOps, ...mapOps]);
    qTotal += hrt() - t;
}

const fmrMs = (fmrTotal / RUNS / 1e6).toFixed(2);
const qMs   = (qTotal   / RUNS / 1e6).toFixed(2);
const speedup = (qTotal / fmrTotal).toFixed(1);
console.log(`  filterMapRef (columnar): ${fmrMs} ms`);
console.log(`  query()      (objects):  ${qMs} ms`);
console.log(`  Speedup: ${speedup}x`);

rsjs.free();
