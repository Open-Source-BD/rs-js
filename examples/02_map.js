'use strict';
// Requires: wasm-pack build --release --target nodejs --out-dir pkg-node
// Run:      node examples/02_map.js

const { process } = require('../js/index.node.cjs');
const { users, orders } = require('./data.js');

async function main() {
    // --- 1. Extract a single field ---
    const names = await process(users, [
        { op: 'map', transforms: [{ field: 'name', expr: { type: 'field', name: 'name' } }] }
    ]);
    console.log('All names:');
    console.log(' ', names.value.map(u => u.name).join(', '));

    // --- 2. Build a full name from first + last using a template ---
    const withFullName = await process(users, [
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
    const withBonus = await process(users, [
        {
            op: 'map',
            transforms: [
                {
                    field: 'bonus',
                    expr: {
                        type: 'arithmetic',
                        op: '*',
                        left:  { type: 'field',   name: 'salary' },
                        right: { type: 'literal',  value: 0.1     }
                    }
                }
            ]
        }
    ]);
    console.log('\nSalary + 10% bonus:');
    console.log(withBonus.value.map(u => `  ${u.name}: $${u.salary} → bonus $${u.bonus}`).join('\n'));

    // --- 4. Add a literal field (e.g. tag all rows with a source label) ---
    const tagged = await process(users, [
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
    const enrichedOrders = await process(orders, [
        {
            op: 'map',
            transforms: [
                {
                    field: 'amountWithTax',
                    expr: {
                        type: 'arithmetic',
                        op: '*',
                        left:  { type: 'field',   name: 'amount' },
                        right: { type: 'literal',  value: 1.2     }
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
    const activeEmails = await process(users, [
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
}

main().catch(console.error);
