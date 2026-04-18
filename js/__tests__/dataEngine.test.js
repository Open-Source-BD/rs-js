'use strict';
const { RsJs } = require('../index.node.cjs');

// ─── shared fixture ───────────────────────────────────────────────────────────

const users = [
    { name: 'Alice', age: 28, salary: 95000, active: true,  dept: 'eng',   score: 0.9 },
    { name: 'Bob',   age: 17, salary:     0, active: false, dept: 'eng',   score: 0.2 },
    { name: 'Carol', age: 35, salary: 120000, active: true, dept: 'sales', score: 0.8 },
    { name: 'Dave',  age: 28, salary: 80000,  active: false, dept: 'sales', score: 0.5 },
];

// ─── query() ─────────────────────────────────────────────────────────────────

describe('query — filter', () => {
    test('eq on boolean — returns only active users', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }]);
        expect(r.type).toBe('array');
        expect(r.value.map(u => u.name)).toEqual(['Alice', 'Carol']);
        // original field values are preserved
        expect(r.value[0].salary).toBe(95000);
        expect(r.value[1].salary).toBe(120000);
        e.free();
    });

    test('eq on string — exact match', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'dept', operator: 'eq', value: 'eng' }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Alice', 'Bob']);
        expect(r.value[0].age).toBe(28);
        expect(r.value[1].age).toBe(17);
        e.free();
    });

    test('ne on string — excludes matching rows', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'dept', operator: 'ne', value: 'eng' }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Carol', 'Dave']);
        e.free();
    });

    test('gt on number — strictly greater', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'age', operator: 'gt', value: 28 }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Carol']);
        expect(r.value[0].age).toBe(35);
        e.free();
    });

    test('gte on number — inclusive', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 28 }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Alice', 'Carol', 'Dave']);
        e.free();
    });

    test('lt on number', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'salary', operator: 'lt', value: 50000 }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Bob']); // only Bob salary=0 < 50000
        expect(r.value[0].salary).toBe(0);
        e.free();
    });

    test('lte on number', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'salary', operator: 'lte', value: 80000 }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Bob', 'Dave']);
        e.free();
    });

    test('and logic — both conditions must hold', () => {
        const e = new RsJs(users);
        const r = e.query([{
            op: 'filter', logic: 'and',
            conditions: [
                { field: 'active', operator: 'eq', value: true },
                { field: 'salary', operator: 'gt', value: 100000 },
            ],
        }]);
        expect(r.value.map(u => u.name)).toEqual(['Carol']);
        expect(r.value[0].salary).toBe(120000);
        e.free();
    });

    test('or logic — either condition sufficient', () => {
        const e = new RsJs(users);
        const r = e.query([{
            op: 'filter', logic: 'or',
            conditions: [
                { field: 'dept', operator: 'eq', value: 'sales' },
                { field: 'age',  operator: 'lt', value: 18 },
            ],
        }]);
        expect(r.value.map(u => u.name)).toEqual(['Bob', 'Carol', 'Dave']);
        e.free();
    });

    test('contains — substring match on string field', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'name', operator: 'contains', value: 'li' }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Alice']);
        e.free();
    });

    test('startsWith', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'name', operator: 'startsWith', value: 'C' }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Carol']);
        e.free();
    });

    test('endsWith', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'name', operator: 'endsWith', value: 'e' }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Alice', 'Dave']);
        e.free();
    });

    test('in — value in list', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'dept', operator: 'in', value: ['sales'] }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Carol', 'Dave']);
        e.free();
    });

    test('notIn — value not in list', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'dept', operator: 'notIn', value: ['sales'] }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Alice', 'Bob']);
        e.free();
    });

    test('isNull — matches null/missing field', () => {
        const data = [{ name: 'X', score: null }, { name: 'Y', score: 1 }, { name: 'Z' }];
        const e = new RsJs(data);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'score', operator: 'isNull', value: null }] }]);
        expect(r.value.map(u => u.name)).toEqual(['X', 'Z']);
        e.free();
    });

    test('isNotNull — excludes null/missing field', () => {
        const data = [{ name: 'X', score: null }, { name: 'Y', score: 1 }, { name: 'Z' }];
        const e = new RsJs(data);
        const r = e.query([{ op: 'filter', conditions: [{ field: 'score', operator: 'isNotNull', value: null }] }]);
        expect(r.value.map(u => u.name)).toEqual(['Y']);
        e.free();
    });

    test('limit + offset windowing', () => {
        const e = new RsJs(users);
        const r = e.query(
            [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 0 }] }],
            { offset: 1, limit: 2 }
        );
        expect(r.value.map(u => u.name)).toEqual(['Bob', 'Carol']);
        e.free();
    });
});

describe('query — map', () => {
    test('arithmetic multiply — adds computed field, preserves originals', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'map', transforms: [{ field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] }]);
        expect(r.type).toBe('array');
        expect(r.value.length).toBe(4);
        expect(r.value[0].name).toBe('Alice');       // original preserved
        expect(r.value[0].salary).toBe(95000);        // original preserved
        expect(r.value[0].bonus).toBeCloseTo(9500);   // computed
        expect(r.value[1].bonus).toBeCloseTo(0);      // Bob salary=0
        expect(r.value[2].bonus).toBeCloseTo(12000);  // Carol
        expect(r.value[3].bonus).toBeCloseTo(8000);   // Dave
        e.free();
    });

    test('arithmetic add', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'map', transforms: [{ field: 'aged', expr: { type: 'arithmetic', op: '+', left: { type: 'field', name: 'age' }, right: { type: 'literal', value: 10 } } }] }]);
        expect(r.value.map(u => u.aged)).toEqual([38, 27, 45, 38]);
        e.free();
    });

    test('arithmetic subtract', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'map', transforms: [{ field: 'diff', expr: { type: 'arithmetic', op: '-', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 50000 } } }] }]);
        expect(r.value[0].diff).toBe(45000);   // Alice 95000-50000
        expect(r.value[1].diff).toBe(-50000);  // Bob 0-50000
        e.free();
    });

    test('arithmetic divide — division by zero → null-like (NaN)', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'map', transforms: [{ field: 'rate', expr: { type: 'arithmetic', op: '/', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0 } } }] }]);
        // Rust: l / 0.0 = Infinity for non-zero, NaN for 0/0; WASM serialises these as null
        expect(r.value[1].rate == null || !isFinite(r.value[1].rate)).toBe(true);
        e.free();
    });

    test('literal transform — constant value on every row', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'map', transforms: [{ field: 'tier', expr: { type: 'literal', value: 'gold' } }] }]);
        expect(r.value.every(u => u.tier === 'gold')).toBe(true);
        e.free();
    });

    test('template transform — interpolates row fields', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'map', transforms: [{ field: 'label', expr: { type: 'template', template: '{name} ({dept})' } }] }]);
        expect(r.value[0].label).toBe('Alice (eng)');
        expect(r.value[2].label).toBe('Carol (sales)');
        e.free();
    });

    test('multiple transforms — all applied in one pass', () => {
        const e = new RsJs(users);
        const r = e.query([{
            op: 'map', transforms: [
                { field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } },
                { field: 'label', expr: { type: 'template', template: '{name}:{dept}' } },
            ],
        }]);
        expect(r.value[0].bonus).toBeCloseTo(9500);
        expect(r.value[0].label).toBe('Alice:eng');
        expect(r.value[2].bonus).toBeCloseTo(12000);
        expect(r.value[2].label).toBe('Carol:sales');
        e.free();
    });
});

describe('query — filter → map pipeline', () => {
    test('filters rows then adds computed field — output same as chained JS', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
            { op: 'map', transforms: [{ field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] },
        ]);
        expect(r.type).toBe('array');
        // active=true: Alice, Carol only
        expect(r.value.length).toBe(2);
        expect(r.value.map(u => u.name)).toEqual(['Alice', 'Carol']);
        expect(r.value[0].bonus).toBeCloseTo(9500);   // Alice 95000 * 0.1
        expect(r.value[1].bonus).toBeCloseTo(12000);  // Carol 120000 * 0.1
        // originals preserved
        expect(r.value[0].salary).toBe(95000);
        expect(r.value[0].name).toBe('Alice');
        e.free();
    });

    test('windowing applies correctly to filter→map', () => {
        const e = new RsJs(users);
        const r = e.query(
            [
                { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 28 }] },
                { op: 'map', transforms: [{ field: 'tax', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.2 } } }] },
            ],
            { offset: 0, limit: 2 }
        );
        expect(r.type).toBe('array');
        expect(r.value.length).toBeLessThanOrEqual(2);
        for (const row of r.value) {
            expect(row.age).toBeGreaterThanOrEqual(28);
            expect(row.tax).toBeCloseTo(row.salary * 0.2);
        }
        e.free();
    });

    test('zero-result filter → map returns empty array', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'salary', operator: 'gt', value: 999999 }] },
            { op: 'map', transforms: [{ field: 'bonus', expr: { type: 'literal', value: 1 } }] },
        ]);
        expect(r.type).toBe('array');
        expect(r.value).toEqual([]);
        e.free();
    });
});

describe('query — reduce', () => {
    test('sum — totals all values', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'reduce', field: 'salary', reducer: 'sum' }]);
        expect(r.type).toBe('number');
        expect(r.value).toBe(295000); // 95000+0+120000+80000
        e.free();
    });

    test('avg — mean of all values', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'reduce', field: 'salary', reducer: 'avg' }]);
        expect(r.type).toBe('number');
        expect(r.value).toBeCloseTo(73750); // 295000/4
        e.free();
    });

    test('min — smallest value', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'reduce', field: 'salary', reducer: 'min' }]);
        expect(r.type).toBe('number');
        expect(r.value).toBe(0); // Bob
        e.free();
    });

    test('max — largest value', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'reduce', field: 'salary', reducer: 'max' }]);
        expect(r.type).toBe('number');
        expect(r.value).toBe(120000); // Carol
        e.free();
    });

    test('first — value from first row', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'reduce', field: 'salary', reducer: 'first' }]);
        expect(r.value).toBe(95000); // Alice
        e.free();
    });

    test('last — value from last row', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'reduce', field: 'salary', reducer: 'last' }]);
        expect(r.value).toBe(80000); // Dave
        e.free();
    });

    test('filter → reduce sum (active users only)', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
            { op: 'reduce', field: 'salary', reducer: 'sum' },
        ]);
        expect(r.value).toBe(215000); // Alice + Carol
        e.free();
    });

    test('filter → reduce avg (eng dept)', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'dept', operator: 'eq', value: 'eng' }] },
            { op: 'reduce', field: 'salary', reducer: 'avg' },
        ]);
        expect(r.value).toBeCloseTo(47500); // (95000+0)/2
        e.free();
    });
});

describe('query — count', () => {
    test('count all rows', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'count' }]);
        expect(r.type).toBe('number');
        expect(r.value).toBe(4);
        e.free();
    });

    test('count truthy field — counts rows where field is truthy', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'count', field: 'active' }]);
        expect(r.value).toBe(2); // Alice + Carol
        e.free();
    });

    test('filter → count (adults)', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] },
            { op: 'count' },
        ]);
        expect(r.type).toBe('number');
        expect(r.value).toBe(3); // Alice, Carol, Dave
        e.free();
    });

    test('filter → count — zero results', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'salary', operator: 'gt', value: 500000 }] },
            { op: 'count' },
        ]);
        expect(r.value).toBe(0);
        e.free();
    });
});

describe('query — find', () => {
    test('finds first matching row and returns all its fields', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'find', conditions: [{ field: 'name', operator: 'eq', value: 'Carol' }] }]);
        expect(r.type).toBe('item');
        expect(r.value.name).toBe('Carol');
        expect(r.value.age).toBe(35);
        expect(r.value.salary).toBe(120000);
        expect(r.value.dept).toBe('sales');
        expect(r.value.active).toBe(true);
        e.free();
    });

    test('returns first match when multiple rows qualify', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'find', conditions: [{ field: 'dept', operator: 'eq', value: 'eng' }] }]);
        expect(r.value.name).toBe('Alice'); // first eng row
        e.free();
    });

    test('not found returns null item', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'find', conditions: [{ field: 'name', operator: 'eq', value: 'Zara' }] }]);
        expect(r.type).toBe('item');
        expect(r.value).toBeNull();
        e.free();
    });

    test('find with multiple and conditions', () => {
        const e = new RsJs(users);
        const r = e.query([{
            op: 'find', logic: 'and',
            conditions: [
                { field: 'dept',   operator: 'eq',  value: 'sales' },
                { field: 'active', operator: 'eq',  value: false   },
            ],
        }]);
        expect(r.value.name).toBe('Dave');
        expect(r.value.salary).toBe(80000);
        e.free();
    });
});

describe('query — groupBy', () => {
    test('no aggregate — groups with rows and correct counts', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'groupBy', field: 'dept' }]);
        expect(r.type).toBe('array');
        expect(r.value.length).toBe(2);
        const eng   = r.value.find(g => g.dept === 'eng');
        const sales = r.value.find(g => g.dept === 'sales');
        expect(eng._count).toBe(2);
        expect(sales._count).toBe(2);
        // rows array contains actual records
        expect(eng.rows.map(u => u.name)).toEqual(['Alice', 'Bob']);
        expect(sales.rows.map(u => u.name)).toEqual(['Carol', 'Dave']);
        e.free();
    });

    test('aggregate sum — totals per group', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'groupBy', field: 'dept', aggregate: [{ field: 'salary', reducer: 'sum', alias: 'total_sal' }] }]);
        expect(r.type).toBe('object');
        expect(r.value.eng._count).toBe(2);
        expect(r.value.eng.total_sal).toBe(95000);    // Alice + Bob
        expect(r.value.sales._count).toBe(2);
        expect(r.value.sales.total_sal).toBe(200000); // Carol + Dave
        e.free();
    });

    test('aggregate avg — mean salary per dept', () => {
        const e = new RsJs(users);
        const r = e.query([{ op: 'groupBy', field: 'dept', aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_sal' }] }]);
        expect(r.value.eng.avg_sal).toBeCloseTo(47500);  // (95000+0)/2
        expect(r.value.sales.avg_sal).toBeCloseTo(100000); // (120000+80000)/2
        e.free();
    });

    test('aggregate min + max — multiple aggregates on same group', () => {
        const e = new RsJs(users);
        const r = e.query([{
            op: 'groupBy', field: 'dept',
            aggregate: [
                { field: 'salary', reducer: 'min', alias: 'min_sal' },
                { field: 'salary', reducer: 'max', alias: 'max_sal' },
            ],
        }]);
        expect(r.value.eng.min_sal).toBe(0);        // Bob
        expect(r.value.eng.max_sal).toBe(95000);    // Alice
        expect(r.value.sales.min_sal).toBe(80000);  // Dave
        expect(r.value.sales.max_sal).toBe(120000); // Carol
        e.free();
    });

    test('filter → groupBy + aggregate (active users only)', () => {
        const e = new RsJs(users);
        const r = e.query([
            { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
            { op: 'groupBy', field: 'dept', aggregate: [{ field: 'salary', reducer: 'sum', alias: 'total' }] },
        ]);
        expect(r.type).toBe('object');
        expect(r.value.eng._count).toBe(1);      // Alice only
        expect(r.value.eng.total).toBe(95000);
        expect(r.value.sales._count).toBe(1);    // Carol only
        expect(r.value.sales.total).toBe(120000);
        e.free();
    });
});

// ─── len / is_empty ───────────────────────────────────────────────────────────

describe('len / is_empty', () => {
    test('len returns row count', () => {
        const e = new RsJs(users);
        expect(e.len()).toBe(4);
        e.free();
    });

    test('is_empty false for non-empty', () => {
        const e = new RsJs(users);
        expect(e.is_empty()).toBe(false);
        e.free();
    });

    test('is_empty true for empty array', () => {
        const e = new RsJs([]);
        expect(e.is_empty()).toBe(true);
        e.free();
    });
});

// ─── filterIndices ────────────────────────────────────────────────────────────

describe('filterIndices', () => {
    test('returns Uint32Array of matching row indices', () => {
        const e = new RsJs(users);
        const idx = e.filterIndices([{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }]);
        expect(idx).toBeInstanceOf(Uint32Array);
        expect(Array.from(idx)).toEqual([0, 2]);
        e.free();
    });

    test('windowed via offset + limit', () => {
        const e = new RsJs(users);
        const idx = e.filterIndices(
            [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }],
            { offset: 1, limit: 2 }
        );
        expect(Array.from(idx)).toEqual([2]); // window=[Bob(17),Carol(35)], only Carol matches
        e.free();
    });
});

// ─── filterViewRef ────────────────────────────────────────────────────────────

describe('filterViewRef', () => {
    test('callback receives relative indices + full window columns', () => {
        const e = new RsJs(users);
        let sel;
        e.filterViewRef(
            [{ op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] }],
            (ref) => { sel = ref; }
        );
        expect(sel.indices).toBeInstanceOf(Uint32Array);
        expect(Array.from(sel.indices)).toEqual([0, 2]); // relative within window
        expect(sel.columns.salary).toBeInstanceOf(Float64Array);
        // Full window (all 4 rows), indexed by relative indices
        expect(sel.columns.salary[sel.indices[0]]).toBe(95000);
        expect(sel.columns.salary[sel.indices[1]]).toBe(120000);
        e.free();
    });

    test('string column categories are present', () => {
        const e = new RsJs(users);
        let sel;
        e.filterViewRef(
            [{ op: 'filter', conditions: [{ field: 'dept', operator: 'eq', value: 'eng' }] }],
            (ref) => { sel = ref; }
        );
        expect(sel.columns.dept.codes).toBeInstanceOf(Uint16Array);
        expect(Array.isArray(sel.columns.dept.categories)).toBe(true);
        e.free();
    });
});

// ─── mapRef ───────────────────────────────────────────────────────────────────

describe('mapRef', () => {
    test('F64 field projection → Float64Array zero-copy view', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'income', expr: { type: 'field', name: 'salary' } }] }],
            (ref) => { view = ref; }
        );
        expect(view.income).toBeInstanceOf(Float64Array);
        expect(Array.from(view.income)).toEqual([95000, 0, 120000, 80000]);
        e.free();
    });

    test('Bool field projection → Uint8Array zero-copy view', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'enabled', expr: { type: 'field', name: 'active' } }] }],
            (ref) => { view = ref; }
        );
        expect(view.enabled).toBeInstanceOf(Uint8Array);
        expect(Array.from(view.enabled)).toEqual([1, 0, 1, 0]);
        e.free();
    });

    test('Str field projection → {codes: Uint16Array, categories}', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'team', expr: { type: 'field', name: 'dept' } }] }],
            (ref) => { view = ref; }
        );
        expect(view.team.codes).toBeInstanceOf(Uint16Array);
        expect(view.team.categories).toEqual(['eng', 'sales']);
        expect(Array.from(view.team.codes)).toEqual([0, 0, 1, 1]);
        e.free();
    });

    test('arithmetic → Float64Array stable after callback', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'bonus', expr: { type: 'arithmetic', op: '*', left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] }],
            (ref) => { view = ref; }
        );
        expect(view.bonus).toBeInstanceOf(Float64Array);
        expect(Array.from(view.bonus)).toEqual([9500, 0, 12000, 8000]);
        e.free();
    });

    test('numeric literal → Float64Array stable after callback', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'tag', expr: { type: 'literal', value: 42 } }] }],
            (ref) => { view = ref; }
        );
        expect(Array.from(view.tag)).toEqual([42, 42, 42, 42]);
        e.free();
    });

    test('template → JS Array of strings', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'label', expr: { type: 'template', template: '{name}:{dept}' } }] }],
            (ref) => { view = ref; }
        );
        expect(Array.isArray(view.label)).toBe(true);
        expect(view.label).toEqual(['Alice:eng', 'Bob:eng', 'Carol:sales', 'Dave:sales']);
        e.free();
    });

    test('windowing via offset + limit', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'income', expr: { type: 'field', name: 'salary' } }] }],
            (ref) => { view = ref; },
            { offset: 1, limit: 2 }
        );
        expect(Array.from(view.income)).toEqual([0, 120000]);
        e.free();
    });

    test('empty window returns empty callback object', () => {
        const e = new RsJs(users);
        let view;
        e.mapRef(
            [{ op: 'map', transforms: [{ field: 'income', expr: { type: 'field', name: 'salary' } }] }],
            (ref) => { view = ref; },
            { offset: 99 }
        );
        expect(view).toEqual({});
        e.free();
    });
});

// ─── groupByIndices ───────────────────────────────────────────────────────────

describe('groupByIndices', () => {
    test('string field → {key: Uint32Array}', () => {
        const e = new RsJs(users);
        const idx = e.groupByIndices('dept');
        expect(idx.eng).toBeInstanceOf(Uint32Array);
        expect(idx.sales).toBeInstanceOf(Uint32Array);
        expect(Array.from(idx.eng)).toEqual([0, 1]);   // Alice, Bob
        expect(Array.from(idx.sales)).toEqual([2, 3]); // Carol, Dave
        e.free();
    });

    test('boolean field → {true: Uint32Array, false: Uint32Array}', () => {
        const e = new RsJs(users);
        const idx = e.groupByIndices('active');
        expect(idx.true).toBeInstanceOf(Uint32Array);
        expect(idx.false).toBeInstanceOf(Uint32Array);
        expect(idx.true.length).toBe(2);   // Alice, Carol
        expect(idx.false.length).toBe(2);  // Bob, Dave
        expect(Array.from(idx.true)).toEqual([0, 2]);
        expect(Array.from(idx.false)).toEqual([1, 3]);
        e.free();
    });

    test('numeric field → {value: Uint32Array} grouped by exact value', () => {
        const e = new RsJs(users);
        const idx = e.groupByIndices('age');
        // Alice and Dave both age 28
        expect(idx['28']).toBeInstanceOf(Uint32Array);
        expect(idx['28'].length).toBe(2);
        expect(idx['17'].length).toBe(1); // Bob
        expect(idx['35'].length).toBe(1); // Carol
        e.free();
    });

    test('unknown field returns empty object', () => {
        const e = new RsJs(users);
        const idx = e.groupByIndices('nonexistent');
        expect(Object.keys(idx).length).toBe(0);
        e.free();
    });
});
