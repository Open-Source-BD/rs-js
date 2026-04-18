'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/01_filter.js

const { RsJs } = require('../js/index.node.cjs');
const { users } = require('./data.js');

const rsjs = new RsJs(users);

// --- 1. Filter adults (age >= 18) ---
const adults = rsjs.query([
    { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }
]);
console.log('Adults (age >= 18):');
console.log(adults.value.map(u => `  ${u.name} (${u.age})`).join('\n'));

// --- 2. Filter active users only ---
const active = rsjs.query([
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }
]);
console.log(`\nActive users: ${active.value.length}`);

// --- 3. Filter by country (multiple values with 'in') ---
const northAmerica = rsjs.query([
    { op: 'filter', conditions: [{ field: 'country', operator: 'in', value: ['US', 'CA'] }] }
]);
console.log('\nNorth America users:');
console.log(northAmerica.value.map(u => `  ${u.name} — ${u.country}`).join('\n'));

// --- 4. Filter name contains "a" (case-sensitive) ---
const withA = rsjs.query([
    { op: 'filter', conditions: [{ field: 'name', operator: 'contains', value: 'a' }] }
]);
console.log(`\nNames containing "a": ${withA.value.map(u => u.name).join(', ')}`);

// --- 5. Multi-condition AND: active senior engineers earning > 100k ---
const seniorEngineers = rsjs.query([
    {
        op: 'filter',
        logic: 'and',
        conditions: [
            { field: 'active',     operator: 'eq', value: true          },
            { field: 'department', operator: 'eq', value: 'engineering' },
            { field: 'salary',     operator: 'gt', value: 100000        },
        ]
    }
]);
console.log('\nSenior engineers (active, engineering, salary > 100k):');
console.log(seniorEngineers.value.map(u => `  ${u.name} — $${u.salary}`).join('\n'));

// --- 6. Multi-condition OR: marketing OR design department ---
const creativeTeams = rsjs.query([
    {
        op: 'filter',
        logic: 'or',
        conditions: [
            { field: 'department', operator: 'eq', value: 'marketing' },
            { field: 'department', operator: 'eq', value: 'design'    },
        ]
    }
]);
console.log('\nCreative teams (marketing OR design):');
console.log(creativeTeams.value.map(u => `  ${u.name} — ${u.department}`).join('\n'));

// --- 7. Filter with offset + limit (pagination) ---
const page2 = rsjs.query([
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }
], { offset: 2, limit: 3 });
console.log('\nActive users (page 2, 3 per page):');
console.log(page2.value.map(u => `  ${u.name}`).join('\n'));

rsjs.free();
