'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/03_reduce.js

const { process } = require('../js/index.node.cjs');
const { users, orders } = require('./data.js');

async function main() {
    // --- 1. Total revenue from completed orders ---
    const revenue = await process(orders, [
        { op: 'filter', conditions: [{ field: 'status', operator: 'eq', value: 'completed' }] },
        { op: 'reduce', field: 'amount', reducer: 'sum' }
    ]);
    console.log(`Total revenue (completed orders): $${revenue.value.toFixed(2)}`);

    // --- 2. Average order value ---
    const avgOrder = await process(orders, [
        { op: 'reduce', field: 'amount', reducer: 'avg' }
    ]);
    console.log(`Average order value: $${avgOrder.value.toFixed(2)}`);

    // --- 3. Highest single order ---
    const maxOrder = await process(orders, [
        { op: 'reduce', field: 'amount', reducer: 'max' }
    ]);
    console.log(`Largest order: $${maxOrder.value.toFixed(2)}`);

    // --- 4. Lowest single order ---
    const minOrder = await process(orders, [
        { op: 'reduce', field: 'amount', reducer: 'min' }
    ]);
    console.log(`Smallest order: $${minOrder.value.toFixed(2)}`);

    // --- 5. Average engineering salary ---
    const avgEngSalary = await process(users, [
        { op: 'filter', conditions: [{ field: 'department', operator: 'eq', value: 'engineering' }] },
        { op: 'reduce', field: 'salary', reducer: 'avg' }
    ]);
    console.log(`\nAverage engineering salary: $${avgEngSalary.value.toLocaleString()}`);

    // --- 6. Total salary for all active employees ---
    const totalPayroll = await process(users, [
        { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
        { op: 'reduce', field: 'salary', reducer: 'sum' }
    ]);
    console.log(`Total active payroll: $${totalPayroll.value.toLocaleString()}`);

    // --- 7. First and last values (useful for time-ordered data) ---
    const firstAmount = await process(orders, [
        { op: 'reduce', field: 'amount', reducer: 'first' }
    ]);
    const lastAmount = await process(orders, [
        { op: 'reduce', field: 'amount', reducer: 'last' }
    ]);
    console.log(`\nFirst order amount: $${firstAmount.value}`);
    console.log(`Last order amount:  $${lastAmount.value}`);

    // --- 8. Max salary per department (manual per-department reduce) ---
    console.log('\nMax salary by department:');
    const departments = ['engineering', 'marketing', 'design'];
    for (const dept of departments) {
        const result = await process(users, [
            { op: 'filter', conditions: [{ field: 'department', operator: 'eq', value: dept }] },
            { op: 'reduce', field: 'salary', reducer: 'max' }
        ]);
        console.log(`  ${dept}: $${result.value.toLocaleString()}`);
    }
}

main().catch(console.error);
