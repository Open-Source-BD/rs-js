'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/02_map.js

const { DataEngine } = require('../js/index.node.cjs');
const { users, orders } = require('./data.js');

const userEngine  = new DataEngine(users);
const orderEngine = new DataEngine(orders);

// --- 1. Extract a single field ---
const names = userEngine.query([
    { op: 'map', transforms: [{ field: 'name', expr: { type: 'field', name: 'name' } }] }
]);
console.log('All names:');
console.log(' ', names.value.map(u => u.name).join(', '));

// --- 2. Build a display name using a template ---
const withFullName = userEngine.query([
    {
        op: 'map',
        transforms: [
            { field: 'fullName', expr: { type: 'template', template: '{first} {last}' } }
        ]
    }
]);
console.log('\nFull names (template):');
console.log(withFullName.value.map(u => `  ${u.fullName}`).join('\n'));

// --- 3. Compute a new field: annual bonus = salary * 0.1 ---
const withBonus = userEngine.query([
    {
        op: 'map',
        transforms: [
            {
                field: 'bonus',
                expr: {
                    type: 'arithmetic',
                    op: '*',
                    left:  { type: 'field',   name: 'salary' },
                    right: { type: 'literal', value: 0.1     }
                }
            }
        ]
    }
]);
console.log('\nSalary + 10% bonus:');
console.log(withBonus.value.map(u => `  ${u.name}: $${u.salary} → bonus $${u.bonus}`).join('\n'));

// --- 4. Add a literal field (tag all rows with a source label) ---
const tagged = userEngine.query([
    {
        op: 'map',
        transforms: [
            { field: 'source', expr: { type: 'literal', value: 'hr-export-2025' } }
        ]
    }
]);
console.log('\nTagged rows (first 3):');
console.log(tagged.value.slice(0, 3).map(u => `  ${u.name} — source: ${u.source}`).join('\n'));

// --- 5. Multiple transforms in one pass: add tax + display label ---
const enrichedOrders = orderEngine.query([
    {
        op: 'map',
        transforms: [
            {
                field: 'amountWithTax',
                expr: {
                    type: 'arithmetic',
                    op: '*',
                    left:  { type: 'field',   name: 'amount' },
                    right: { type: 'literal', value: 1.2     }
                }
            },
            {
                field: 'label',
                expr: { type: 'template', template: 'Order #{id} — {product}' }
            }
        ]
    }
]);
console.log('\nEnriched orders (first 4):');
console.log(enrichedOrders.value.slice(0, 4).map(o =>
    `  ${o.label} | $${o.amount} → $${Number(o.amountWithTax).toFixed(2)} (inc. tax)`
).join('\n'));

// --- 6. Filter first, then map (pipeline) ---
const activeEmails = userEngine.query([
    { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
    {
        op: 'map',
        transforms: [
            { field: 'email', expr: { type: 'template', template: '{name}@company.com' } }
        ]
    }
]);
console.log('\nEmail addresses for active users:');
console.log(activeEmails.value.map(u => `  ${u.email}`).join('\n'));

// --- 7. Zero-copy columnar map (mapRef) — field projection, no row objects ---
console.log('\nSalary column (zero-copy via mapRef):');
userEngine.mapRef(
    [{ op: 'map', transforms: [{ field: 'salary', expr: { type: 'field', name: 'salary' } }] }],
    (ref) => {
        console.log(' ', Array.from(ref.salary).map(v => `$${v}`).join(', '));
    }
);

userEngine.free();
orderEngine.free();
