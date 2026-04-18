'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/05_count.js

const { DataEngine } = require('../js/index.node.cjs');
const { users, orders, events } = require('./data.js');

const userEngine  = new DataEngine(users);
const orderEngine = new DataEngine(orders);
const eventEngine = new DataEngine(events);

// --- 1. Count all records ---
const total = userEngine.query([{ op: 'count' }]);
console.log(`Total users: ${total.value}`);

// --- 2. Count after filter ---
const adultCount = userEngine.query([
    { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
    { op: 'count' }
]);
console.log(`Adults (age >= 18): ${adultCount.value}`);

// --- 3. Count active users ---
const activeCount = userEngine.query([
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
    { op: 'count' }
]);
console.log(`Active users: ${activeCount.value}`);

// --- 4. Count by truthy field ---
const truthyCount = userEngine.query([
    { op: 'count', field: 'active' }
]);
console.log(`Users with active=true: ${truthyCount.value}`);

// --- 5. Count completed orders ---
const completedOrders = orderEngine.query([
    { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
    { op: 'count' }
]);
console.log(`\nCompleted orders: ${completedOrders.value}`);

// --- 6. Count click events ---
const clickCount = eventEngine.query([
    { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: 'click' }] },
    { op: 'count' }
]);
console.log(`Click events: ${clickCount.value}`);

// --- 7. Per-type event count ---
console.log('\nEvent counts by type:');
for (const type of ['click', 'purchase', 'signup']) {
    const result = eventEngine.query([
        { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: type }] },
        { op: 'count' }
    ]);
    console.log(`  ${type}: ${result.value}`);
}

// --- 8. Count with limit (count only the first 5 rows) ---
const limitedCount = userEngine.query([{ op: 'count' }], { limit: 5 });
console.log(`\nCount (first 5 rows only): ${limitedCount.value}`);

// --- 9. Conversion rate: purchases / total events ---
const totalEvents  = eventEngine.query([{ op: 'count' }]);
const purchases    = eventEngine.query([
    { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: 'purchase' }] },
    { op: 'count' }
]);
const rate = ((purchases.value / totalEvents.value) * 100).toFixed(1);
console.log(`\nConversion rate: ${purchases.value}/${totalEvents.value} = ${rate}%`);

// --- 10. Engine helpers ---
console.log(`\nEngine size check: ${userEngine.len()} rows, empty=${userEngine.is_empty()}`);

userEngine.free();
orderEngine.free();
eventEngine.free();
