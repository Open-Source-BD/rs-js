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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_dataengine_free: (a: number, b: number) => void;
    readonly __wbg_preparedquery_free: (a: number, b: number) => void;
    readonly _init: () => void;
    readonly dataengine_filterIndices: (a: number, b: any, c: number) => [number, number, number];
    readonly dataengine_filterMapRef: (a: number, b: any, c: any, d: number, e: any) => [number, number, number];
    readonly dataengine_filterViewRef: (a: number, b: any, c: number, d: any) => [number, number, number];
    readonly dataengine_groupByIndices: (a: number, b: number, c: number) => [number, number, number];
    readonly dataengine_is_empty: (a: number) => number;
    readonly dataengine_len: (a: number) => number;
    readonly dataengine_mapRef: (a: number, b: any, c: number, d: any) => [number, number, number];
    readonly dataengine_new: (a: any) => [number, number, number];
    readonly dataengine_query: (a: number, b: any, c: number) => [number, number, number];
    readonly dataengine_queryPrepared: (a: number, b: number, c: number) => [number, number, number];
    readonly preparedquery_new: (a: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
