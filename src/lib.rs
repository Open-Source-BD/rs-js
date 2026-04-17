mod column_store;
mod engine;
mod eval;
mod operations;
mod types;

use column_store::{Col, ColumnStore, try_columnar};
use engine::execute_for_engine;
use js_sys::{Array, Float64Array, Object, Uint8Array, Uint16Array, Uint32Array};
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::Serializer;
use types::{DataError, Dataset, Operation, PipelineOptions};
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

    /// Returns columnar typed arrays for matching rows — no per-row object serialization.
    /// F64 fields → Float64Array. Bool fields → Uint8Array.
    /// Str fields → `{ codes: Uint16Array, categories: string[] }`.
    #[wasm_bindgen(js_name = "filterView")]
    pub fn filter_view(
        &self,
        operations: JsValue,
        options: Option<JsValue>,
    ) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;
        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        let mut indices: Vec<u32> = match ops.as_slice() {
            [Operation::Filter(f)] => self.col_store.filter_indices(&f.conditions, &f.logic, start, end),
            _ => (start as u32..end as u32).collect(),
        };
        indices.sort_unstable();
        let n = indices.len();

        // Stable column order
        let col_refs: Vec<(&str, &Col)> = self.col_store.cols.iter()
            .map(|(k, v)| (k.as_str(), v))
            .collect();

        // Per-column output buffers — typed to avoid branching in the hot loop
        enum ColBuf {
            F64(Vec<f64>),
            Bool(Vec<u8>),
            StrCodes(Vec<u16>),
        }

        let mut bufs: Vec<ColBuf> = col_refs.iter().map(|(_, col)| match col {
            Col::F64(_)  => ColBuf::F64(Vec::with_capacity(n)),
            Col::Bool(_) => ColBuf::Bool(Vec::with_capacity(n)),
            Col::Str(_)  => ColBuf::StrCodes(Vec::with_capacity(n)),
        }).collect();

        // Single pass through indices — fills all column buffers at once.
        // Traversing the indices Vec once (instead of ncols times) cuts cache
        // pressure proportional to the number of columns.
        for &raw_i in &indices {
            let i = raw_i as usize;
            for j in 0..col_refs.len() {
                match (&mut bufs[j], col_refs[j].1) {
                    (ColBuf::F64(buf), Col::F64(v))       => buf.push(v[i]),
                    (ColBuf::Bool(buf), Col::Bool(v))     => buf.push(v[i]),
                    (ColBuf::StrCodes(buf), Col::Str(sc)) => buf.push(sc.codes[i]),
                    _ => {}
                }
            }
        }

        // Emit JS typed arrays
        let out = Object::new();
        for j in 0..col_refs.len() {
            let name = col_refs[j].0;
            let val: JsValue = match (&bufs[j], col_refs[j].1) {
                (ColBuf::F64(v), Col::F64(_)) => {
                    let arr = Float64Array::new_with_length(v.len() as u32);
                    arr.copy_from(v);
                    arr.into()
                }
                (ColBuf::Bool(v), Col::Bool(_)) => {
                    let arr = Uint8Array::new_with_length(v.len() as u32);
                    arr.copy_from(v);
                    arr.into()
                }
                (ColBuf::StrCodes(codes), Col::Str(sc)) => {
                    let codes_arr = Uint16Array::new_with_length(codes.len() as u32);
                    codes_arr.copy_from(codes);

                    // For high-cardinality columns (e.g. unique name per row),
                    // JSON.parse is orders of magnitude faster than 500K individual
                    // Array::push() calls across the WASM→JS boundary.
                    let cats_val: JsValue = if sc.categories.len() > 500 {
                        let json = serde_json::to_string(
                            &sc.categories.iter()
                                .map(|c| c.as_deref().unwrap_or("null"))
                                .collect::<Vec<_>>()
                        ).unwrap_or_else(|_| "[]".to_string());
                        js_sys::JSON::parse(&json).unwrap_or(JsValue::UNDEFINED)
                    } else {
                        let cats_arr = Array::new();
                        for cat in &sc.categories {
                            cats_arr.push(&JsValue::from(cat.as_deref().unwrap_or("null")));
                        }
                        cats_arr.into()
                    };

                    let obj = Object::new();
                    js_sys::Reflect::set(&obj, &"codes".into(), &codes_arr.into())?;
                    js_sys::Reflect::set(&obj, &"categories".into(), &cats_val)?;
                    obj.into()
                }
                _ => continue,
            };
            js_sys::Reflect::set(&out, &JsValue::from(name), &val)?;
        }
        Ok(out.into())
    }

    /// Compute new field(s) from map ops — returns `{ fieldName: Float64Array }`.
    /// Only the computed columns, not full rows. Use for arithmetic transforms.
    #[wasm_bindgen(js_name = "mapField")]
    pub fn map_field(
        &self,
        operations: JsValue,
        options: Option<JsValue>,
    ) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;
        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        let out = Object::new();
        for op in &ops {
            if let Operation::Map(m) = op {
                for transform in &m.transforms {
                    let vals = self.col_store.compute_field(&transform.expr, start, end);
                    let arr = Float64Array::new_with_length(vals.len() as u32);
                    arr.copy_from(&vals);
                    js_sys::Reflect::set(&out, &JsValue::from(&*transform.field), &arr.into())?;
                }
            }
        }
        Ok(out.into())
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
            [Operation::Filter(f)] => self.col_store.filter_indices(&f.conditions, &f.logic, start, end),
            _ => (start as u32..end as u32).collect(),
        };

        if indices.is_empty() {
            callback.call1(&JsValue::NULL, &Object::new().into())?;
            return Ok(JsValue::UNDEFINED);
        }

        let out = Object::new();
        let memory = wasm_bindgen::memory().dyn_into::<js_sys::WebAssembly::Memory>()?.buffer();

        for (name, col) in &self.col_store.cols {
            let val = match col {
                Col::F64(v) => {
                    let offset = v.as_ptr() as u32 / 8;
                    Float64Array::new(&memory).subarray(offset + indices[0], offset + indices[0] + indices.len() as u32).into()
                }
                Col::Bool(v) => {
                    let offset = v.as_ptr() as u32;
                    Uint8Array::new(&memory).subarray(offset + indices[0], offset + indices[0] + indices.len() as u32).into()
                }
                Col::Str(sc) => {
                    let offset = sc.codes.as_ptr() as u32 / 2;
                    Uint16Array::new(&memory).subarray(offset + indices[0], offset + indices[0] + indices.len() as u32).into()
                }
            };
            js_sys::Reflect::set(&out, &JsValue::from(name), &val)?;
        }
        
        callback.call1(&JsValue::NULL, &out.into())?;
        Ok(JsValue::UNDEFINED)
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

fn serialize_result(result: impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = Serializer::json_compatible();
    result
        .serialize(&serializer)
        .map_err(|e: serde_wasm_bindgen::Error| JsValue::from(JsError::new(&e.to_string())))
}
