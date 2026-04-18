'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/benchmark_ref.js

const { DataEngine } = require('../js/index.node.cjs');

function generateData(n) {
    return Array.from({ length: n }, (_, i) => ({
        id:         i + 1,
        name:       'User_' + i,
        age:        16 + (i % 50),
        department: 'dept_' + (i % 5),
        salary:     30000 + (i % 120000),
        active:     i % 3 !== 0,
    }));
}

function hrt() { return Number(process.hrtime.bigint()); }
function ms(ns) { return (ns / 1e6).toFixed(2) + ' ms'; }

const n = 100_000;
const data = generateData(n);
const engine = new DataEngine(data);

const filterOps = [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }];
const mapOps    = [{ op: 'map', transforms: [{ field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] }];

console.log(`--- Zero-copy API comparison (${n.toLocaleString()} rows) ---\n`);

// filterViewRef — columnar views into WASM memory (zero-copy, callback scoped)
let t = hrt();
engine.filterViewRef(filterOps, (ref) => {
    void ref.indices.length;  // access to prevent optimisation
});
console.log(`filterViewRef (zero-copy callback):   ${ms(hrt() - t)}`);

// filterIndices — Uint32Array of matching row indices
t = hrt();
engine.filterIndices(filterOps);
console.log(`filterIndices (Uint32Array):           ${ms(hrt() - t)}`);

// mapRef — columnar computed/projected views (zero-copy for field projections)
t = hrt();
engine.mapRef(mapOps, (ref) => {
    void ref.bonus.length;
});
console.log(`mapRef        (zero-copy callback):   ${ms(hrt() - t)}`);

// groupByIndices — raw index buckets per group
t = hrt();
engine.groupByIndices('department');
console.log(`groupByIndices (Uint32Array/group):    ${ms(hrt() - t)}`);

// query (filter) — returns row objects via JS routing
t = hrt();
engine.query(filterOps);
console.log(`\nquery filter  (row objects):          ${ms(hrt() - t)}`);

// query (map) — returns row objects via mapRef+merge routing
t = hrt();
engine.query(mapOps);
console.log(`query map     (row objects):          ${ms(hrt() - t)}`);

console.log('\nNote: *Ref / *Indices skip row serialization entirely.');
console.log('      query() returns plain JS objects — use *Ref when you need max throughput.');

engine.free();
