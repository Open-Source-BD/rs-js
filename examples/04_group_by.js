'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/04_group_by.js

const { RsJs } = require('../js/index.node.cjs');
const { users, orders, events } = require('./data.js');

const usersRsJs  = new RsJs(users);
const ordersRsJs = new RsJs(orders);
const eventsRsJs = new RsJs(events);

// --- 1. Group users by country (no aggregates) ---
// Returns: { type: 'array', value: [{ _group, _count, country, rows }, ...] }
const byCountry = usersRsJs.query([
    { op: 'groupBy', field: 'country' }
]);
console.log('Users by country:');
byCountry.value.forEach(g => {
    const names = g.rows.map(u => u.name).join(', ');
    console.log(`  ${g.country} (${g._count}): ${names}`);
});

// --- 2. Group by department with salary aggregates ---
// Returns: { type: 'object', value: { engineering: { _count, avg_salary, max_salary }, ... } }
const deptStats = usersRsJs.query([
    {
        op: 'groupBy',
        field: 'department',
        aggregate: [
            { field: 'salary', reducer: 'avg', alias: 'avg_salary'    },
            { field: 'salary', reducer: 'max', alias: 'max_salary'    },
            { field: 'salary', reducer: 'sum', alias: 'total_payroll' },
        ]
    }
]);
console.log('\nDepartment salary stats:');
Object.entries(deptStats.value).forEach(([dept, stats]) => {
    console.log(`  ${dept}:`);
    console.log(`    headcount:     ${stats._count}`);
    console.log(`    avg salary:    $${Number(stats.avg_salary).toLocaleString()}`);
    console.log(`    max salary:    $${Number(stats.max_salary).toLocaleString()}`);
    console.log(`    total payroll: $${Number(stats.total_payroll).toLocaleString()}`);
});

// --- 3. Group orders by status with revenue sum ---
const orderStats = ordersRsJs.query([
    {
        op: 'groupBy',
        field: 'status',
        aggregate: [
            { field: 'amount', reducer: 'sum', alias: 'total_amount' },
            { field: 'amount', reducer: 'avg', alias: 'avg_amount'   },
        ]
    }
]);
console.log('\nOrder stats by status:');
Object.entries(orderStats.value).forEach(([status, stats]) => {
    console.log(`  ${status}: ${stats._count} orders, total $${Number(stats.total_amount).toFixed(2)}, avg $${Number(stats.avg_amount).toFixed(2)}`);
});

// --- 4. Group events by type (count only) ---
const eventGroups = eventsRsJs.query([
    { op: 'groupBy', field: 'type' }
]);
console.log('\nEvent type breakdown:');
eventGroups.value.forEach(g => {
    console.log(`  ${g.type}: ${g._count}`);
});

// --- 5. Multi-field group: country + department ---
const crossGroup = usersRsJs.query([
    {
        op: 'groupBy',
        field: ['country', 'department'],
        aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }]
    }
]);
console.log('\nCross group (country × department):');
Object.entries(crossGroup.value).forEach(([key, stats]) => {
    const [country, dept] = key.split('||');
    console.log(`  ${country} / ${dept}: ${stats._count} people, avg $${Number(stats.avg_salary).toLocaleString()}`);
});

// --- 6. Filter first, then group: active users by country ---
const activeByCountry = usersRsJs.query([
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
    { op: 'groupBy', field: 'country' }
]);
console.log('\nActive users by country:');
activeByCountry.value.forEach(g => {
    console.log(`  ${g.country}: ${g._count} active users`);
});

// --- 7. Zero-copy group indices (groupByIndices) — raw index buckets, no row objects ---
console.log('\nDepartment buckets (zero-copy indices):');
const idx = usersRsJs.groupByIndices('department');
Object.entries(idx).forEach(([dept, ids]) => {
    console.log(`  ${dept}: ${ids.length} users (indices: ${Array.from(ids).join(', ')})`);
});

usersRsJs.free();
ordersRsJs.free();
eventsRsJs.free();
