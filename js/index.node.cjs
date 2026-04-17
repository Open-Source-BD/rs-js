'use strict';
let InternalDataEngine, InternalPreparedQuery;

try {
    // nodejs target auto-loads the .wasm at require time — no initSync needed
    const wasm = require('../pkg-node/rs_js.js');
    InternalDataEngine = wasm.DataEngine;
    InternalPreparedQuery = wasm.PreparedQuery;
} catch {
    throw new Error(
        '\n[rs-js] WASM build not found.\n' +
        'Run once to compile:\n\n' +
        '  npm run build\n\n' +
        'Requires wasm-pack (one-time install):\n' +
        '  cargo install wasm-pack\n'
    );
}


function applyWindow(data, options) {
    if (!options) return data;
    const offset = Number.isInteger(options.offset) ? options.offset : 0;
    const start = Math.max(0, offset);
    const end = Number.isInteger(options.limit) ? start + Math.max(0, options.limit) : data.length;
    return data.slice(start, Math.min(end, data.length));
}

function evalCondition(row, cond) {
    const value = row[cond.field];
    switch (cond.operator) {
        case 'eq': return value === cond.value;
        case 'ne': return value !== cond.value;
        case 'gt': return value > cond.value;
        case 'gte': return value >= cond.value;
        case 'lt': return value < cond.value;
        case 'lte': return value <= cond.value;
        default: return false;
    }
}

function evalConditions(row, conditions, logic = 'and') {
    if (logic === 'or') return conditions.some((c) => evalCondition(row, c));
    return conditions.every((c) => evalCondition(row, c));
}

function evalMapExpr(row, expr) {
    switch (expr.type) {
        case 'literal': return expr.value;
        case 'field': return row[expr.name] ?? null;
        case 'template': {
            let out = expr.template;
            for (const [k, v] of Object.entries(row)) {
                out = out.replaceAll(`{${k}}`, String(v));
            }
            return out;
        }
        case 'arithmetic': {
            const l = Number(evalMapExpr(row, expr.left));
            const r = Number(evalMapExpr(row, expr.right));
            switch (expr.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/': return r === 0 ? null : l / r;
                default: return null;
            }
        }
        default:
            return null;
    }
}

class DataEngine {
    constructor(data, options = {}) {
        this._data = data;
        this._engine = new InternalDataEngine(data);
        this._prepared = new Map();
        // Per-operation crossover thresholds (tuned from benchmarks).
        // smallRowThreshold overrides all for backward compatibility.
        if (Number.isInteger(options.smallRowThreshold)) {
            this._filterThreshold  = options.smallRowThreshold;
            this._mapThreshold     = options.smallRowThreshold;
            this._groupByThreshold = options.smallRowThreshold;
        } else {
            this._filterThreshold  = Number.isInteger(options.filterThreshold)  ? options.filterThreshold  : 15_000;
            this._mapThreshold     = Number.isInteger(options.mapThreshold)     ? options.mapThreshold     : 300_000;
            this._groupByThreshold = Number.isInteger(options.groupByThreshold) ? options.groupByThreshold : 2_000;
        }
    }

    _getPrepared(operations) {
        const key = JSON.stringify(operations);
        let pq = this._prepared.get(key);
        if (!pq) {
            pq = new InternalPreparedQuery(operations);
            this._prepared.set(key, pq);
        }
        return pq;
    }

    _mapField(operations, options) {
        if (typeof this._engine.mapField === 'function') {
            return this._engine.mapField(operations, options);
        }
        if (typeof this._engine.mapFieldRef === 'function') {
            let result;
            this._engine.mapFieldRef(operations, (view) => {
                result = view;
                return view;
            }, options);
            return result;
        }
        throw new TypeError('WASM engine does not expose mapField or mapFieldRef');
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
            const rows = windowed.map((row) => {
                const out = { ...row };
                for (const t of op.transforms) out[t.field] = evalMapExpr(out, t.expr);
                return out;
            });
            return { type: 'array', value: rows };
        }

        const computed = this._mapField([{ op: 'map', transforms: op.transforms }], options);
        const n = windowed.length;
        const rows = new Array(n);
        const entries = Object.entries(computed);
        const n_fields = entries.length;

        // Pre-extract source keys once to avoid per-row property enumeration.
        const srcKeys = n > 0 ? Object.keys(windowed[0]) : [];
        const srcLen = srcKeys.length;

        for (let i = 0; i < n; i++) {
            const src = windowed[i];
            const row = {};
            for (let k = 0; k < srcLen; k++) row[srcKeys[k]] = src[srcKeys[k]];
            for (let j = 0; j < n_fields; j++) row[entries[j][0]] = entries[j][1][i];
            rows[i] = row;
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

        const prepared = this._getPrepared(operations);
        return this._engine.queryPrepared(prepared, options);
    }

    free() {
        for (const pq of this._prepared.values()) pq.free();
        this._prepared.clear();
        this._engine.free();
    }

    len() {
        return this._engine.len();
    }

    is_empty() {
        return this._engine.is_empty();
    }

    // Exposed for advanced users
    filterIndices(ops, opts) { return this._engine.filterIndices(ops, opts); }
    filterView(ops, opts) { return this._engine.filterView(ops, opts); }
    filterViewRef(ops, callback, opts) { return this._engine.filterViewRef(ops, opts, callback); }
    mapField(ops, opts) { return this._mapField(ops, opts); }
    groupByIndices(field) { return this._engine.groupByIndices(field); }
}

module.exports = { DataEngine };
