'use strict';
const { DataEngine } = require('../js/index.node.cjs');

function generateData(n) {
    return Array.from({ length: n }, (_, i) => ({
        id:         i + 1,
        name:       'User_' + i,
        age:        16 + (i % 50),
        department: 'dept_' + (i % 5),
        salary:     30000 + (i % 120000),
    }));
}

const n = 100000;
const data = generateData(n);
const engine = new DataEngine(data);
const filterOps = [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }];

console.log('--- Testing filterView (Copy) vs filterViewRef (Zero-Copy) ---');

const startCopy = process.hrtime.bigint();
const copy = engine.filterView(filterOps);
const endCopy = process.hrtime.bigint();
console.log('filterView (copy) took:', ((endCopy - startCopy) / 1000000n).toString() + ' ms');

const startRef = process.hrtime.bigint();
engine.filterViewRef(filterOps, (ref) => {
    // Access view here
});
const endRef = process.hrtime.bigint();
console.log('filterViewRef (ref) took:', ((endRef - startRef) / 1000000n).toString() + ' ms');

engine.free();
