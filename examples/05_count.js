'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/05_count.js

const { process } = require('../js/index.node.cjs');
const { users, orders, events } = require('./data.js');

async function main() {
    // --- 1. Count all records ---
    const total = await process(users, [
        { op: 'count' }
    ]);
    console.log(`Total users: ${total.value}`);

    // --- 2. Count after filter ---
    const adultCount = await process(users, [
        { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
        { op: 'count' }
    ]);
    console.log(`Adults (age >= 18): ${adultCount.value}`);

    // --- 3. Count active users ---
    const activeCount = await process(users, [
        { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
        { op: 'count' }
    ]);
    console.log(`Active users: ${activeCount.value}`);

    // --- 4. Count by truthy field (count users where active is set and truthy) ---
    const truthyCount = await process(users, [
        { op: 'count', field: 'active' }
    ]);
    console.log(`Users with active=true: ${truthyCount.value}`);

    // --- 5. Count completed orders ---
    const completedOrders = await process(orders, [
        { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
        { op: 'count' }
    ]);
    console.log(`\nCompleted orders: ${completedOrders.value}`);

    // --- 6. Count click events ---
    const clickCount = await process(events, [
        { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: 'click' }] },
        { op: 'count' }
    ]);
    console.log(`Click events: ${clickCount.value}`);

    // --- 7. Per-type event count (demonstrate count across grouped data) ---
    console.log('\nEvent counts by type:');
    const eventTypes = ['click', 'purchase', 'signup'];
    for (const type of eventTypes) {
        const result = await process(events, [
            { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: type }] },
            { op: 'count' }
        ]);
        console.log(`  ${type}: ${result.value}`);
    }

    // --- 8. Count with limit (count only the first 5 records) ---
    const limitedCount = await process(users, [
        { op: 'count' }
    ], { limit: 5 });
    console.log(`\nCount (first 5 rows only): ${limitedCount.value}`);

    // --- 9. Conversion rate: purchases / total events ---
    const totalEvents = await process(events, [{ op: 'count' }]);
    const purchases = await process(events, [
        { op: 'filter', conditions: [{ field: 'type', operator: 'eq', value: 'purchase' }] },
        { op: 'count' }
    ]);
    const rate = ((purchases.value / totalEvents.value) * 100).toFixed(1);
    console.log(`\nConversion rate: ${purchases.value}/${totalEvents.value} = ${rate}%`);
}

main().catch(console.error);
