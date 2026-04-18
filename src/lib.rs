mod column_store;
mod engine;
mod eval;
mod operations;
mod types;

use column_store::{Col, ColumnStore, try_columnar};
use engine::execute_for_engine;
use js_sys::{Array, Float64Array, Object, Uint8Array, Uint16Array, Uint32Array};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_wasm_bindgen::Serializer;
use types::{DataError, Dataset, FieldTransform, MapExpr, Operation, PipelineOptions, Row};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();
}

// ── DataEngine: stateful API — deserialize once, query many times ──────────

#[wasm_bindgen]
pub struct DataEngine {
    data: Dataset,
    col_store: ColumnStore,
}

#[wasm_bindgen]
pub struct PreparedQuery {
    ops: Vec<Operation>,
}

#[wasm_bindgen]
impl PreparedQuery {
    /// Parse operations once and reuse this handle for repeated queries.
    #[wasm_bindgen(constructor)]
    pub fn new(operations: JsValue) -> Result<PreparedQuery, JsValue> {
        let ops = deserialize_ops(operations)?;
        Ok(PreparedQuery { ops })
    }
}

#[wasm_bindgen]
impl DataEngine {
    /// Load data into WASM memory once. Builds row store + columnar store.
    #[wasm_bindgen(constructor)]
    pub fn new(data: JsValue) -> Result<DataEngine, JsValue> {
        let dataset = deserialize_dataset(data)?;
        let col_store = ColumnStore::from_rows(&dataset);
        Ok(DataEngine {
            data: dataset,
            col_store,
        })
    }

    /// Run a pipeline. Scalar-returning ops use the columnar fast path;
    /// array-returning ops fall back to the row-based engine.
    pub fn query(&self, operations: JsValue, options: Option<JsValue>) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;

        self.query_with_ops(&ops, opts)
    }

    /// Execute a previously prepared operation plan.
    #[wasm_bindgen(js_name = "queryPrepared")]
    pub fn query_prepared(
        &self,
        prepared: &PreparedQuery,
        options: Option<JsValue>,
    ) -> Result<JsValue, JsValue> {
        let opts = deserialize_opts(options)?;
        self.query_with_ops(&prepared.ops, opts)
    }

    fn query_with_ops(&self, ops: &[Operation], opts: PipelineOptions) -> Result<JsValue, JsValue> {
        let ops_vec = ops.to_vec();

        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        if let Some(result) = try_columnar(&self.col_store, &self.data, ops, start, end) {
            return serialize_result(result.map_err(JsValue::from)?);
        }

        let result = execute_for_engine(&self.data, opts, ops_vec).map_err(JsValue::from)?;
        serialize_result(result)
    }

    #[wasm_bindgen(js_name = "filterIndices")]
    pub fn filter_indices(
        &self,
        operations: JsValue,
        options: Option<JsValue>,
    ) -> Result<Uint32Array, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;

        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        let indices = match ops.as_slice() {
            [Operation::Filter(f)] => {
                self.col_store
                    .filter_indices(&f.conditions, &f.logic, start, end)
            }
            _ => (start as u32..end as u32).collect(),
        };

        let arr = Uint32Array::new_with_length(indices.len() as u32);
        arr.copy_from(&indices);
        Ok(arr)
    }

    /// Returns `{ group_key: Uint32Array }` — zero row serialization.
    /// JS reconstructs: `for ([k,v] of Object.entries(idx)) result[k] = Array.from(v, i=>data[i])`
    #[wasm_bindgen(js_name = "groupByIndices")]
    pub fn group_by_indices(&self, field: &str) -> Result<JsValue, JsValue> {
        let groups = self
            .col_store
            .group_by_indices_raw(field, None, 0, self.col_store.len);
        let obj = Object::new();
        for (key, indices) in groups {
            let arr = Uint32Array::new_with_length(indices.len() as u32);
            arr.copy_from(&indices);
            js_sys::Reflect::set(&obj, &JsValue::from(&*key), &arr.into())?;
        }
        Ok(obj.into())
    }

    /// Zero-copy map for all expression types.
    /// Field projections → TypedArray subarrays into WASM memory (stable until engine.free()).
    /// Arithmetic / numeric literals → Float64Array copied to JS heap (stable after callback).
    /// Template / string literals → JS Array (strings cannot be zero-copy).
    #[wasm_bindgen(js_name = "mapRef")]
    pub fn map_ref(
        &self,
        operations: JsValue,
        options: Option<JsValue>,
        callback: &js_sys::Function,
    ) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;
        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        let out = Object::new();
        if start >= end {
            callback.call1(&JsValue::NULL, &out.into())?;
            return Ok(JsValue::UNDEFINED);
        }

        // Collect all transforms across all map ops.
        let mut transforms: Vec<&FieldTransform> = Vec::new();
        for op in &ops {
            let Operation::Map(map) = op else {
                return Err(JsValue::from(DataError::InvalidExpr(
                    "mapRef only supports map operations".into(),
                )));
            };
            transforms.extend(map.transforms.iter());
        }

        // Phase 1 — Rust-heap allocations (may grow WASM linear memory).
        // Arithmetic/literal → Vec<f64>. Template/string literal → JSON String.
        // Col::Str field → pre-build categories JsValue (serde_json::to_string if high-cardinality).
        enum Pre {
            F64(Vec<f64>),   // arithmetic or numeric literal
            Json(String),    // template or non-numeric literal
            StrCats(JsValue),// Str field: pre-built categories
            Nothing,         // F64/Bool field — no phase-1 work
        }

        let pre: Vec<Pre> = transforms
            .iter()
            .map(|t| -> Result<Pre, JsValue> {
                match &t.expr {
                    MapExpr::Arithmetic { .. } => {
                        let mut vals = Vec::with_capacity(end - start);
                        for row in &self.data[start..end] {
                            let v = eval_map_expr_value(row, &t.expr)?;
                            vals.push(v.as_f64().unwrap_or(f64::NAN));
                        }
                        Ok(Pre::F64(vals))
                    }
                    MapExpr::Literal { value } => {
                        if let Some(n) = value.as_f64() {
                            Ok(Pre::F64(vec![n; end - start]))
                        } else {
                            let strings: Vec<String> = (0..end - start)
                                .map(|_| value.to_string())
                                .collect();
                            Ok(Pre::Json(
                                serde_json::to_string(&strings)
                                    .unwrap_or_else(|_| "[]".to_string()),
                            ))
                        }
                    }
                    MapExpr::Template { .. } => {
                        let mut strings: Vec<String> = Vec::with_capacity(end - start);
                        for row in &self.data[start..end] {
                            let v = eval_map_expr_value(row, &t.expr)?;
                            strings.push(
                                v.as_str().map(|s| s.to_owned()).unwrap_or_default(),
                            );
                        }
                        Ok(Pre::Json(
                            serde_json::to_string(&strings)
                                .unwrap_or_else(|_| "[]".to_string()),
                        ))
                    }
                    MapExpr::Field { name } => {
                        match self.col_store.cols.get(name.as_str()) {
                            Some(Col::Str(sc)) => {
                                let cats: JsValue = if sc.categories.len() > 500 {
                                    let json = serde_json::to_string(
                                        &sc.categories
                                            .iter()
                                            .map(|c| c.as_deref().unwrap_or("null"))
                                            .collect::<Vec<_>>(),
                                    )
                                    .unwrap_or_else(|_| "[]".to_string());
                                    js_sys::JSON::parse(&json).unwrap_or(JsValue::UNDEFINED)
                                } else {
                                    let arr = Array::new();
                                    for cat in &sc.categories {
                                        arr.push(&JsValue::from(
                                            cat.as_deref().unwrap_or("null"),
                                        ));
                                    }
                                    arr.into()
                                };
                                Ok(Pre::StrCats(cats))
                            }
                            _ => Ok(Pre::Nothing),
                        }
                    }
                }
            })
            .collect::<Result<Vec<_>, _>>()?;

        // Phase 2 — capture WASM memory buffer (no more Rust allocations after this).
        let memory = wasm_bindgen::memory()
            .dyn_into::<js_sys::WebAssembly::Memory>()?
            .buffer();

        // Phase 3 — build output object using stable memory reference.
        for (transform, p) in transforms.iter().zip(pre.iter()) {
            let val: JsValue = match (&transform.expr, p) {
                (MapExpr::Arithmetic { .. } | MapExpr::Literal { .. }, Pre::F64(vals)) => {
                    let arr = Float64Array::new_with_length(vals.len() as u32);
                    arr.copy_from(vals);
                    arr.into()
                }
                (MapExpr::Template { .. } | MapExpr::Literal { .. }, Pre::Json(json)) => {
                    js_sys::JSON::parse(json).unwrap_or(JsValue::UNDEFINED)
                }
                (MapExpr::Field { name }, Pre::Nothing) => {
                    match self.col_store.cols.get(name.as_str()) {
                        Some(Col::F64(v)) => {
                            let offset = v.as_ptr() as u32 / 8;
                            Float64Array::new(&memory)
                                .subarray(offset + start as u32, offset + end as u32)
                                .into()
                        }
                        Some(Col::Bool(v)) => {
                            let offset = v.as_ptr() as u32;
                            Uint8Array::new(&memory)
                                .subarray(offset + start as u32, offset + end as u32)
                                .into()
                        }
                        _ => JsValue::UNDEFINED,
                    }
                }
                (MapExpr::Field { name }, Pre::StrCats(cats)) => {
                    let sc = match self.col_store.cols.get(name.as_str()) {
                        Some(Col::Str(sc)) => sc,
                        _ => {
                            js_sys::Reflect::set(
                                &out,
                                &JsValue::from(&*transform.field),
                                &JsValue::UNDEFINED,
                            )?;
                            continue;
                        }
                    };
                    let offset = sc.codes.as_ptr() as u32 / 2;
                    let codes = Uint16Array::new(&memory)
                        .subarray(offset + start as u32, offset + end as u32);
                    let obj = Object::new();
                    js_sys::Reflect::set(&obj, &"codes".into(), &codes.into())?;
                    js_sys::Reflect::set(&obj, &"categories".into(), cats)?;
                    obj.into()
                }
                _ => JsValue::UNDEFINED,
            };
            js_sys::Reflect::set(&out, &JsValue::from(&*transform.field), &val)?;
        }

        // Phase 4 — invoke callback. Float64Array views over `pre` Vecs are valid here.
        callback.call1(&JsValue::NULL, &out.into())?;
        // `pre` dropped here — Float64Array views into WASM-heap Vecs are invalidated.
        Ok(JsValue::UNDEFINED)
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    #[wasm_bindgen(js_name = "filterViewRef")]
    pub fn filter_view_ref(
        &self,
        operations: JsValue,
        options: Option<JsValue>,
        callback: &js_sys::Function,
    ) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;
        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        let indices: Vec<u32> = match ops.as_slice() {
            [Operation::Filter(f)] => {
                self.col_store
                    .filter_indices(&f.conditions, &f.logic, start, end)
            }
            _ => (start as u32..end as u32).collect(),
        };

        if indices.is_empty() {
            callback.call1(&JsValue::NULL, &Object::new().into())?;
            return Ok(JsValue::UNDEFINED);
        }

        let relative = Uint32Array::new_with_length(indices.len() as u32);
        let rel_values: Vec<u32> = indices.iter().map(|&i| i - start as u32).collect();
        relative.copy_from(&rel_values);

        let out = Object::new();
        let columns = self.window_column_views(start, end)?;
        js_sys::Reflect::set(&out, &"indices".into(), &relative.into())?;
        js_sys::Reflect::set(&out, &"columns".into(), &columns)?;

        callback.call1(&JsValue::NULL, &out.into())?;
        Ok(JsValue::UNDEFINED)
    }

    fn window_column_views(&self, start: usize, end: usize) -> Result<JsValue, JsValue> {
        // Phase 1 — pre-compute string categories (serde_json::to_string may grow WASM
        // linear memory, which detaches any wasm.memory.buffer captured before this).
        // We do all Rust allocations here before taking the memory snapshot.
        let cats_by_col: Vec<Option<JsValue>> = self
            .col_store
            .cols
            .values()
            .map(|col| {
                let Col::Str(sc) = col else { return None };
                let val: JsValue = if sc.categories.len() > 500 {
                    // JSON.parse is orders of magnitude faster than N individual
                    // Array::push() calls across the WASM→JS boundary.
                    let json = serde_json::to_string(
                        &sc.categories
                            .iter()
                            .map(|c| c.as_deref().unwrap_or("null"))
                            .collect::<Vec<_>>(),
                    )
                    .unwrap_or_else(|_| "[]".to_string());
                    js_sys::JSON::parse(&json).unwrap_or(JsValue::UNDEFINED)
                } else {
                    let arr = Array::new();
                    for cat in &sc.categories {
                        arr.push(&JsValue::from(cat.as_deref().unwrap_or("null")));
                    }
                    arr.into()
                };
                Some(val)
            })
            .collect();

        // Phase 2 — capture memory buffer once all Rust allocations are done.
        let memory = wasm_bindgen::memory()
            .dyn_into::<js_sys::WebAssembly::Memory>()?
            .buffer();

        // Phase 3 — build typed-array views; no Rust allocations from here on.
        let out = Object::new();
        for ((name, col), maybe_cats) in self.col_store.cols.iter().zip(cats_by_col) {
            let val: JsValue = match col {
                Col::F64(v) => {
                    let offset = v.as_ptr() as u32 / 8;
                    Float64Array::new(&memory)
                        .subarray(offset + start as u32, offset + end as u32)
                        .into()
                }
                Col::Bool(v) => {
                    let offset = v.as_ptr() as u32;
                    Uint8Array::new(&memory)
                        .subarray(offset + start as u32, offset + end as u32)
                        .into()
                }
                Col::Str(sc) => {
                    let offset = sc.codes.as_ptr() as u32 / 2;
                    let codes = Uint16Array::new(&memory)
                        .subarray(offset + start as u32, offset + end as u32);
                    let cats_val = maybe_cats.unwrap_or(JsValue::UNDEFINED);
                    let obj = Object::new();
                    js_sys::Reflect::set(&obj, &"codes".into(), &codes.into())?;
                    js_sys::Reflect::set(&obj, &"categories".into(), &cats_val)?;
                    obj.into()
                }
            };
            js_sys::Reflect::set(&out, &JsValue::from(name), &val)?;
        }

        Ok(out.into())
    }
}

// ── shared helpers ─────────────────────────────────────────────────────────

fn deserialize_dataset(val: JsValue) -> Result<Dataset, JsValue> {
    let d = serde_wasm_bindgen::Deserializer::from(val);
    Dataset::deserialize(d).map_err(|e| {
        JsValue::from(JsError::new(
            &DataError::Deserialize(e.to_string()).to_string(),
        ))
    })
}

fn deserialize_ops(val: JsValue) -> Result<Vec<Operation>, JsValue> {
    let d = serde_wasm_bindgen::Deserializer::from(val);
    Vec::<Operation>::deserialize(d).map_err(|e| {
        JsValue::from(JsError::new(
            &DataError::Deserialize(e.to_string()).to_string(),
        ))
    })
}

fn deserialize_opts(val: Option<JsValue>) -> Result<PipelineOptions, JsValue> {
    match val {
        Some(v) if !v.is_undefined() && !v.is_null() => {
            let d = serde_wasm_bindgen::Deserializer::from(v);
            PipelineOptions::deserialize(d).map_err(|e| {
                JsValue::from(JsError::new(
                    &DataError::Deserialize(e.to_string()).to_string(),
                ))
            })
        }
        _ => Ok(PipelineOptions::default()),
    }
}

fn eval_map_expr_value(row: &Row, expr: &MapExpr) -> Result<Value, JsValue> {
    match expr {
        MapExpr::Literal { value } => Ok(value.clone()),
        MapExpr::Field { name } => Ok(row.get(name).cloned().unwrap_or(Value::Null)),
        MapExpr::Template { template } => {
            let mut result = template.clone();
            for (k, v) in row {
                let placeholder = format!("{{{}}}", k);
                let replacement = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                result = result.replace(&placeholder, &replacement);
            }
            Ok(Value::String(result))
        }
        MapExpr::Arithmetic { op, left, right } => {
            let l = eval_map_expr_value(row, left)?.as_f64().ok_or_else(|| {
                JsValue::from(DataError::InvalidExpr("left operand not a number".into()))
            })?;
            let r = eval_map_expr_value(row, right)?.as_f64().ok_or_else(|| {
                JsValue::from(DataError::InvalidExpr("right operand not a number".into()))
            })?;
            let result = match op {
                types::ArithOp::Add => l + r,
                types::ArithOp::Sub => l - r,
                types::ArithOp::Mul => l * r,
                types::ArithOp::Div => {
                    if r == 0.0 {
                        return Err(JsValue::from(DataError::InvalidExpr(
                            "division by zero".into(),
                        )));
                    }
                    l / r
                }
            };
            serde_json::Number::from_f64(result)
                .map(Value::Number)
                .ok_or_else(|| {
                    JsValue::from(DataError::InvalidExpr("result is NaN or Infinity".into()))
                })
        }
    }
}

fn serialize_result(result: impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = Serializer::json_compatible();
    result
        .serialize(&serializer)
        .map_err(|e: serde_wasm_bindgen::Error| JsValue::from(JsError::new(&e.to_string())))
}
