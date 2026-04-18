/* tslint:disable */
/* eslint-disable */

export class DataEngine {
    free(): void;
    [Symbol.dispose](): void;
    filterIndices(operations: any, options?: any | null): Uint32Array;
    /**
     * Combined filter + map → gathered typed-array columns. Zero row-object creation.
     * Returns all original columns (gathered to matched rows) plus computed transform columns.
     * Views are valid only inside the callback; do not retain them after it returns.
     */
    filterMapRef(filter_operations: any, map_operations: any, options: any | null | undefined, callback: Function): any;
    filterViewRef(operations: any, options: any | null | undefined, callback: Function): any;
    /**
     * Returns `{ group_key: Uint32Array }` — zero row serialization.
     * JS reconstructs: `for ([k,v] of Object.entries(idx)) result[k] = Array.from(v, i=>data[i])`
     */
    groupByIndices(field: string): any;
    is_empty(): boolean;
    len(): number;
    /**
     * Zero-copy map for all expression types.
     * Field projections → TypedArray subarrays into WASM memory (stable until engine.free()).
     * Arithmetic / numeric literals → Float64Array copied to JS heap (stable after callback).
     * Template / string literals → JS Array (strings cannot be zero-copy).
     */
    mapRef(operations: any, options: any | null | undefined, callback: Function): any;
    /**
     * Load data into WASM memory once. Builds row store + columnar store.
     */
    constructor(data: any);
    /**
     * Run a pipeline. Scalar-returning ops use the columnar fast path;
     * array-returning ops fall back to the row-based engine.
     */
    query(operations: any, options?: any | null): any;
    /**
     * Execute a previously prepared operation plan.
     */
    queryPrepared(prepared: PreparedQuery, options?: any | null): any;
}

export class PreparedQuery {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Parse operations once and reuse this handle for repeated queries.
     */
    constructor(operations: any);
}

export function _init(): void;
