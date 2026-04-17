const { DataEngine } = require('../index.node.cjs');

describe('DataEngine', () => {
    const users = [
        { name: 'Alice', age: 28, salary: 95000, active: true, dept: 'eng' },
        { name: 'Bob', age: 17, salary: 0, active: false, dept: 'eng' },
        { name: 'Carol', age: 35, salary: 120000, active: true, dept: 'sales' },
    ];

    test('filter', () => {
        const engine = new DataEngine(users);
        const result = engine.query([{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }]);
        expect(result.type).toBe('array');
        expect(result.value.length).toBe(2);
        engine.free();
    });

    test('map', () => {
        const engine = new DataEngine(users);
        const result = engine.query([{ op: 'map', transforms: [{ field: 'bonus', expr: { type: 'literal', value: 100 } }] }]);
        expect(result.type).toBe('array');
        expect(result.value[0].bonus).toBe(100);
        engine.free();
    });

    test('reduce', () => {
        const engine = new DataEngine(users);
        const result = engine.query([{ op: 'reduce', field: 'salary', reducer: 'sum' }]);
        expect(result.type).toBe('number');
        expect(result.value).toBe(215000);
        engine.free();
    });

    test('count', () => {
        const engine = new DataEngine(users);
        const result = engine.query([{ op: 'count' }]);
        expect(result.type).toBe('number');
        expect(result.value).toBe(3);
        engine.free();
    });

    test('groupBy', () => {
        const engine = new DataEngine(users);
        const result = engine.query([{ op: 'groupBy', field: 'dept' }]);
        expect(result.type).toBe('array');
        expect(result.value.length).toBe(2);
        engine.free();
    });

    test('find', () => {
        const engine = new DataEngine(users);
        const result = engine.query([{ op: 'find', conditions: [{ field: 'name', operator: 'eq', value: 'Alice' }] }]);
        expect(result.type).toBe('item');
        expect(result.value.name).toBe('Alice');
        engine.free();
    });

    test('pipeline', () => {
        const engine = new DataEngine(users);
        const result = engine.query([
            { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
            { op: 'reduce', field: 'salary', reducer: 'sum' }
        ]);
        expect(result.type).toBe('number');
        expect(result.value).toBe(215000);
        engine.free();
    });
});
