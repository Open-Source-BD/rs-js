export type Operator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "notIn"
  | "isNull"
  | "isNotNull";

export interface Condition {
  field: string;
  operator: Operator;
  value: unknown;
}

export type ConditionLogic = "and" | "or";

export type MapExpr =
  | { type: "literal"; value: unknown }
  | { type: "field"; name: string }
  | { type: "template"; template: string }
  | {
      type: "arithmetic";
      op: "+" | "-" | "*" | "/";
      left: MapExpr;
      right: MapExpr;
    };

export interface ReduceOpInline {
  field: string;
  reducer: "sum" | "avg" | "min" | "max" | "first" | "last";
  alias?: string;
}

export type Operation =
  | { op: "filter"; conditions: Condition[]; logic?: ConditionLogic }
  | { op: "map"; transforms: Array<{ field: string; expr: MapExpr }> }
  | {
      op: "reduce";
      field: string;
      reducer: "sum" | "avg" | "min" | "max" | "first" | "last";
      alias?: string;
    }
  | { op: "groupBy"; field: string | string[]; aggregate?: ReduceOpInline[] }
  | { op: "count"; field?: string }
  | { op: "find"; conditions: Condition[]; logic?: ConditionLogic };

export interface PipelineOptions {
  limit?: number;
  offset?: number;
  includeMeta?: boolean;
}

export type PipelineResult =
  | { type: "array"; value: Record<string, unknown>[] }
  | { type: "number"; value: number }
  | { type: "object"; value: Record<string, Record<string, unknown>> }
  | { type: "item"; value: Record<string, unknown> | null };

export interface StrColumnView {
  codes: Uint16Array;
  categories: string[];
}

export type ColumnView = Float64Array | Uint8Array | StrColumnView;

export interface FilterView {
  [field: string]: ColumnView;
}

export interface FilterSelectionRef {
  indices: Uint32Array;
  columns: FilterView;
}

export interface MapRefView {
  [field: string]: Float64Array | Uint8Array | Uint16Array | StrColumnView | unknown[];
}

export interface DataEngineOptions {
  smallRowThreshold?: number;
  filterThreshold?: number;
  groupByThreshold?: number;
}

export declare class DataEngine {
  constructor(data: Record<string, unknown>[], options?: DataEngineOptions);
  query(operations: Operation[], options?: PipelineOptions): PipelineResult;
  /** Returns matching row indices as Uint32Array. */
  filterIndices(
    operations: Operation[],
    options?: PipelineOptions,
  ): Uint32Array;
  /** Calls back with sparse selection indices plus zero-copy window column views. */
  filterViewRef(
    operations: Operation[],
    callback: (view: FilterSelectionRef) => unknown,
    options?: PipelineOptions,
  ): unknown;
  /**
   * Zero-copy map for all expression types.
   * Field projections → TypedArray subarrays (zero-copy into WASM memory, stable until engine.free()).
   * Arithmetic / numeric literals → Float64Array copied to JS heap (stable after callback).
   * Template / string literals → JS Array (strings cannot be zero-copy).
   */
  mapRef(
    operations: Operation[],
    callback: (view: MapRefView) => unknown,
    options?: PipelineOptions,
  ): unknown;
  /** Returns `{ groupKey: Uint32Array }` of row indices per group. No row serialization. */
  groupByIndices(field: string): Record<string, Uint32Array>;
  len(): number;
  is_empty(): boolean;
  free(): void;
}

export declare function createEngine(
  data: Record<string, unknown>[],
  options?: DataEngineOptions,
): Promise<DataEngine>;
