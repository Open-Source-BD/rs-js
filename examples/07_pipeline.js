'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/07_pipeline.js

const { RsJs } = require('../js/index.node.cjs');
const { users, orders, events } = require('./data.js');

const usersRsJs  = new RsJs(users);
const ordersRsJs = new RsJs(orders);
const eventsRsJs = new RsJs(events);

// --- 1. Analytics: active US users, grouped by department with avg salary ---
const usTeamStats = usersRsJs.query([
    {
        op: 'filter',
        logic: 'and',
        conditions: [
            { field: 'country', operator: 'eq', value: 'US'  },
            { field: 'active',  operator: 'eq', value: true  },
        ]
    },
    {
        op: 'groupBy',
        field: 'department',
        aggregate: [
            { field: 'salary', reducer: 'avg', alias: 'avg_salary' },
            { field: 'salary', reducer: 'sum', alias: 'payroll'    },
        ]
    }
]);
console.log('US active team stats:');
Object.entries(usTeamStats.value).forEach(([dept, s]) => {
    console.log(`  ${dept}: ${s._count} people, avg $${Number(s.avg_salary).toLocaleString()}, payroll $${Number(s.payroll).toLocaleString()}`);
});

// --- 2. Revenue dashboard: completed orders → total + avg + count ---
const totalRev   = ordersRsJs.query([
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'reduce', field: 'amount', reducer: 'sum' }
]);
const avgRev     = ordersRsJs.query([
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'reduce', field: 'amount', reducer: 'avg' }
]);
const orderCount = ordersRsJs.query([
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'count' }
]);
console.log('\nRevenue dashboard (completed orders):');
console.log(`  total:   $${totalRev.value.toFixed(2)}`);
console.log(`  average: $${avgRev.value.toFixed(2)}`);
console.log(`  count:   ${orderCount.value}`);

// --- 3. User enrichment: filter → map (add email + seniority score) ---
const enriched = usersRsJs.query([
    {
        op: 'filter',
        logic: 'and',
        conditions: [
            { field: 'active',     operator: 'eq', value: true          },
            { field: 'department', operator: 'eq', value: 'engineering' },
        ]
    },
    {
        op: 'map',
        transforms: [
            { field: 'email', expr: { type: 'template', template: '{name}@company.com' } },
            {
                field: 'seniorityLevel',
                expr: {
                    type: 'arithmetic', op: '/',
                    left:  { type: 'field',   name: 'salary' },
                    right: { type: 'literal', value: 10000   }
                }
            }
        ]
    }
]);
console.log('\nEnriched engineering team:');
enriched.value.forEach(u => {
    console.log(`  ${u.name} <${u.email}> — seniority score: ${Number(u.seniorityLevel).toFixed(1)}`);
});

// --- 4. Event funnel analysis: count each stage ---
console.log('\nEvent funnel:');
const funnelStages = ['click', 'signup', 'purchase'];
const funnel = funnelStages.map(type => ({
    type,
    count: eventsRsJs.query([
        { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: type }] },
        { op: 'count' }
    ]).value
}));
funnel.forEach(({ type, count }, i) => {
    const prev = i === 0 ? null : funnel[i - 1].count;
    const dropoff = prev ? ` (${((1 - count / prev) * 100).toFixed(0)}% drop from prev)` : '';
    console.log(`  ${type}: ${count}${dropoff}`);
});

// --- 5. Top earner: filter active adults → find highest salary ---
const topEarner = usersRsJs.query([
    {
        op: 'filter',
        logic: 'and',
        conditions: [
            { field: 'active', operator: 'eq',  value: true },
            { field: 'age',    operator: 'gte', value: 18   },
        ]
    },
    { op: 'find', conditions: [{ field: 'salary', operator: 'gte', value: 140000 }] }
]);
console.log(`\nTop earner (salary >= 140k): ${topEarner.value?.name} ($${topEarner.value?.salary})`);

// --- 6. Country revenue breakdown from completed orders ---
const countryRevenue = ordersRsJs.query([
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    {
        op: 'groupBy',
        field: 'country',
        aggregate: [
            { field: 'amount', reducer: 'sum', alias: 'revenue'   },
            { field: 'amount', reducer: 'avg', alias: 'avg_order' },
        ]
    }
]);
console.log('\nRevenue by country (completed orders):');
Object.entries(countryRevenue.value).forEach(([country, s]) => {
    console.log(`  ${country}: $${Number(s.revenue).toFixed(2)} total, $${Number(s.avg_order).toFixed(2)} avg (${s._count} orders)`);
});

// --- 7. Zero-copy columnar filter (filterViewRef) ---
console.log('\nAge + salary columns for adults (zero-copy filterViewRef):');
usersRsJs.filterViewRef(
    [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }],
    (ref) => {
        const ages    = Array.from(ref.columns.age);
        const salaries = Array.from(ref.columns.salary);
        ages.forEach((age, i) => console.log(`  age=${age}, salary=$${salaries[i]}`));
    }
);

usersRsJs.free();
ordersRsJs.free();
eventsRsJs.free();
