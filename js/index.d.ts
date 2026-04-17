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

export interface DataEngineOptions {
  smallRowThreshold?: number;
}

export declare class DataEngine {
  constructor(data: Record<string, unknown>[], options?: DataEngineOptions);
  query(operations: Operation[], options?: PipelineOptions): PipelineResult;
  /** Returns matching row indices as Uint32Array. */
  filterIndices(
    operations: Operation[],
    options?: PipelineOptions,
  ): Uint32Array;
  /** Returns columnar typed arrays for matching rows — no per-row object serialization. */
  filterView(operations: Operation[], options?: PipelineOptions): FilterView;
  /** Returns `{ fieldName: Float64Array }` for each computed map transform. */
  mapField(
    operations: Operation[],
    options?: PipelineOptions,
  ): Record<string, Float64Array>;
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
