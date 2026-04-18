'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/06_find.js

const { DataEngine } = require('../js/index.node.cjs');
const { users, orders } = require('./data.js');

const userEngine  = new DataEngine(users);
const orderEngine = new DataEngine(orders);

// --- 1. Find user by ID ---
const user = userEngine.query([
    { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 3 }] }
]);
if (user.value) {
    console.log(`Found user #3: ${user.value.name}, ${user.value.department}, $${user.value.salary}`);
}

// --- 2. Find returns null when no match ---
const missing = userEngine.query([
    { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: 999 }] }
]);
console.log(`User #999: ${missing.value === null ? 'not found' : 'found'}`);

// --- 3. Find first user in a given department ---
const firstEngineer = userEngine.query([
    { op: 'find', conditions: [{ field: 'department', operator: 'eq', value: 'engineering' }] }
]);
console.log(`\nFirst engineer: ${firstEngineer.value?.name}`);

// --- 4. Find first UK user with salary > 80k ---
const seniorUK = userEngine.query([
    {
        op: 'find',
        logic: 'and',
        conditions: [
            { field: 'country', operator: 'eq', value: 'UK'   },
            { field: 'salary',  operator: 'gt', value: 80000  },
            { field: 'active',  operator: 'eq', value: true   },
        ]
    }
]);
console.log(`First senior UK user: ${seniorUK.value?.name} ($${seniorUK.value?.salary})`);

// --- 5. Find first completed order for a user ---
const userOrder = orderEngine.query([
    {
        op: 'find',
        logic: 'and',
        conditions: [
            { field: 'userId', operator: 'eq', value: 1           },
            { field: 'status', operator: 'eq', value: 'completed' },
        ]
    }
]);
console.log(`\nFirst completed order for user #1: $${userOrder.value?.amount} (${userOrder.value?.product})`);

// --- 6. Find using 'startsWith' on a string field ---
const graceOrGary = userEngine.query([
    { op: 'find', conditions: [{ field: 'name', operator: 'startsWith', value: 'Gr' }] }
]);
console.log(`First name starting with "Gr": ${graceOrGary.value?.name}`);

// --- 7. Find with OR logic: first person who is in marketing OR under 20 ---
const youngOrMarketing = userEngine.query([
    {
        op: 'find',
        logic: 'or',
        conditions: [
            { field: 'department', operator: 'eq', value: 'marketing' },
            { field: 'age',        operator: 'lt', value: 20          },
        ]
    }
]);
console.log(`First match (marketing OR under 20): ${youngOrMarketing.value?.name} (${youngOrMarketing.value?.department}, age ${youngOrMarketing.value?.age})`);

// --- 8. Safe lookup helper pattern ---
function findUserById(id) {
    const result = userEngine.query([
        { op: 'find', conditions: [{ field: 'id', operator: 'eq', value: id }] }
    ]);
    return result.value; // null if not found
}

const u = findUserById(7);
console.log(`\nUser lookup (id=7): ${u ? `${u.name} found` : 'not found'}`);

userEngine.free();
orderEngine.free();
