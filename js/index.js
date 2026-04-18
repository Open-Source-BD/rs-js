let _initPromise = null;

function getWasm() {
    if (!_initPromise) {
        _initPromise = import('../pkg/rs_js.js').then(async (mod) => {
            await mod.default();
            return mod;
        });
    }
    return _initPromise;
}

/**
 * Create a stateful RsJs engine. Deserializes data once into WASM memory.
 * Call .query() many times without re-serializing the dataset.
 *
 * @param {Record<string, unknown>[]} data
 * @param {import('./index.d.ts').RsJsOptions} [options]
 * @returns {Promise<RsJs>}
 */
export async function createRsJs(data, options) {
    const wasm = await getWasm();
    return new RsJs(data, wasm, options);
}

function applyWindow(data, options) {
    if (!options) return data;
    const offset = Number.isInteger(options.offset) ? options.offset : 0;
    const start = Math.max(0, offset);
    const end = Number.isInteger(options.limit) ? start + Math.max(0, options.limit) : data.length;
    return data.slice(start, Math.min(end, data.length));
}

function evalMapExpr(row, expr) {
    if (expr.type === 'literal') return expr.value;
    if (expr.type === 'field')   return row[expr.name] ?? null;
    if (expr.type === 'template') return expr.template.replace(/\{(\w+)\}/g, (_, k) => row[k] ?? '');
    if (expr.type === 'arithmetic') {
        const l = evalMapExpr(row, expr.left);
        const r = evalMapExpr(row, expr.right);
        if (expr.op === '+') return l + r;
        if (expr.op === '-') return l - r;
        if (expr.op === '*') return l * r;
        if (expr.op === '/') return r === 0 ? null : l / r;
    }
    return null;
}

function evalCondition(row, cond) {
    const value = row[cond.field];
    switch (cond.operator) {
        case 'eq':         return value === cond.value;
        case 'ne':         return value !== cond.value;
        case 'gt':         return value > cond.value;
        case 'gte':        return value >= cond.value;
        case 'lt':         return value < cond.value;
        case 'lte':        return value <= cond.value;
        case 'contains':   return typeof value === 'string' && typeof cond.value === 'string' && value.includes(cond.value);
        case 'startsWith': return typeof value === 'string' && typeof cond.value === 'string' && value.startsWith(cond.value);
        case 'endsWith':   return typeof value === 'string' && typeof cond.value === 'string' && value.endsWith(cond.value);
        case 'in':         return Array.isArray(cond.value) && cond.value.includes(value);
        case 'notIn':      return Array.isArray(cond.value) && !cond.value.includes(value);
        case 'isNull':     return value == null;
        case 'isNotNull':  return value != null;
        default: return false;
    }
}

function evalConditions(row, conditions, logic = 'and') {
    if (logic === 'or') return conditions.some((c) => evalCondition(row, c));
    return conditions.every((c) => evalCondition(row, c));
}

export class RsJs {
    constructor(data, wasm, options = {}) {
        this._data = data;
        this._engine = new wasm.DataEngine(data);
        this._wasm = wasm;
        this._prepared = new Map();
        if (Number.isInteger(options.smallRowThreshold)) {
            this._filterThreshold  = options.smallRowThreshold;
            this._mapThreshold     = options.smallRowThreshold;
            this._groupByThreshold = options.smallRowThreshold;
        } else {
            this._filterThreshold  = Number.isInteger(options.filterThreshold)  ? options.filterThreshold  : 15_000;
            this._mapThreshold     = Number.isInteger(options.mapThreshold)     ? options.mapThreshold     : 15_000;
            this._groupByThreshold = Number.isInteger(options.groupByThreshold) ? options.groupByThreshold : 30_000;
        }
    }

    _getPrepared(operations) {
        const key = JSON.stringify(operations);
        let pq = this._prepared.get(key);
        if (!pq) {
            pq = new this._wasm.PreparedQuery(operations);
            this._prepared.set(key, pq);
        }
        return pq;
    }

    _queryFilter(op, options) {
        const windowed = applyWindow(this._data, options);
        if (windowed.length <= this._filterThreshold) {
            const rows = windowed.filter((r) => evalConditions(r, op.conditions, op.logic));
            return { type: 'array', value: rows };
        }
        const idx = this._engine.filterIndices([{ op: 'filter', conditions: op.conditions, logic: op.logic ?? 'and' }], options);
        const m = idx.length;
        const rows = new Array(m);
        for (let i = 0; i < m; i++) rows[i] = this._data[idx[i]];
        return { type: 'array', value: rows };
    }

    _queryMap(op, options) {
        const windowed = applyWindow(this._data, options);
        if (windowed.length <= this._mapThreshold) {
            return { type: 'array', value: windowed.map((row) => {
                const out = { ...row };
                for (const t of op.transforms) out[t.field] = evalMapExpr(row, t.expr);
                return out;
            })};
        }
        let cols;
        this._engine.mapRef([op], options, (ref) => { cols = ref; });
        return { type: 'array', value: windowed.map((row, i) => {
            const out = { ...row };
            for (const t of op.transforms) out[t.field] = cols[t.field][i];
            return out;
        })};
    }

    _queryFilterMap(filterOp, mapOp, options) {
        const start = (options && Number.isInteger(options.offset)) ? Math.max(0, options.offset) : 0;
        const windowed = applyWindow(this._data, options);
        if (windowed.length <= this._filterThreshold) {
            const filtered = windowed.filter((r) => evalConditions(r, filterOp.conditions, filterOp.logic));
            return { type: 'array', value: filtered.map((row) => {
                const out = { ...row };
                for (const t of mapOp.transforms) out[t.field] = evalMapExpr(row, t.expr);
                return out;
            })};
        }
        const idx = this._engine.filterIndices([filterOp], options);
        const m = idx.length;
        if (m === 0) return { type: 'array', value: [] };
        let cols;
        this._engine.mapRef([mapOp], options, (ref) => { cols = ref; });
        const rows = new Array(m);
        for (let i = 0; i < m; i++) {
            const ri = idx[i];
            const ci = ri - start;
            const out = { ...this._data[ri] };
            for (const t of mapOp.transforms) out[t.field] = cols[t.field][ci];
            rows[i] = out;
        }
        return { type: 'array', value: rows };
    }

    _queryGroupByNoAgg(op, options) {
        const fields = Array.isArray(op.field) ? op.field : [op.field];
        if (fields.length !== 1) return this._engine.query([{ op: 'groupBy', field: op.field }], options);

        const field = fields[0];
        const windowed = applyWindow(this._data, options);
        if (windowed.length <= this._groupByThreshold) {
            const groups = {};
            for (const row of windowed) {
                const key = row[field] == null ? 'null' : String(row[field]);
                (groups[key] ??= []).push(row);
            }
            const out = [];
            for (const [key, rows] of Object.entries(groups)) {
                const sample = rows[0] || {};
                out.push({ _group: key, _count: rows.length, [field]: sample[field], rows });
            }
            return { type: 'array', value: out };
        }

        const idx = this._engine.groupByIndices(field);
        const out = [];
        for (const [key, ids] of Object.entries(idx)) {
            const rows = new Array(ids.length);
            for (let i = 0; i < ids.length; i++) rows[i] = this._data[ids[i]];
            const sample = rows[0] || {};
            out.push({ _group: key, _count: rows.length, [field]: sample[field], rows });
        }
        return { type: 'array', value: out };
    }

    query(operations, options) {
        if (operations.length === 1 && operations[0].op === 'filter') {
            return this._queryFilter(operations[0], options);
        }
        if (operations.length === 1 && operations[0].op === 'map') {
            return this._queryMap(operations[0], options);
        }
        if (operations.length === 1 && operations[0].op === 'groupBy' && (!operations[0].aggregate || operations[0].aggregate.length === 0)) {
            return this._queryGroupByNoAgg(operations[0], options);
        }
        if (operations.length === 2 &&
            operations[0].op === 'filter' &&
            operations[1].op === 'map') {
            return this._queryFilterMap(operations[0], operations[1], options);
        }

        const prepared = this._getPrepared(operations);
        return this._engine.queryPrepared(prepared, options);
    }

    free() {
        for (const pq of this._prepared.values()) pq.free();
        this._prepared.clear();
        this._engine.free();
    }

    len()      { return this._engine.len(); }
    is_empty() { return this._engine.is_empty(); }

    filterIndices(ops, opts)              { return this._engine.filterIndices(ops, opts); }
    filterViewRef(ops, callback, opts)    { return this._engine.filterViewRef(ops, opts, callback); }
    mapRef(ops, callback, opts)           { return this._engine.mapRef(ops, opts, callback); }
    groupByIndices(field)                 { return this._engine.groupByIndices(field); }
}
