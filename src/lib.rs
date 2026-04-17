mod column_store;
mod engine;
mod eval;
mod operations;
mod types;

use column_store::{try_columnar, ColumnStore};
use engine::{execute_for_engine, Pipeline};
use js_sys::Uint32Array;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::Serializer;
use types::{DataError, Dataset, Operation, PipelineOptions};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();
}

// ── process_raw: original one-shot API (serialize data every call) ─────────

#[wasm_bindgen(js_name = "processRaw")]
pub fn process_raw(
    data: JsValue,
    operations: JsValue,
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let dataset = deserialize_dataset(data)?;
    let ops = deserialize_ops(operations)?;
    let opts = deserialize_opts(options)?;

    let result = Pipeline::new(dataset, opts)
        .execute(ops)
        .map_err(JsValue::from)?;

    serialize_result(result)
}

// ── DataEngine: stateful API — deserialize once, query many times ──────────

#[wasm_bindgen]
pub struct DataEngine {
    data: Dataset,
    col_store: ColumnStore,
}

#[wasm_bindgen]
impl DataEngine {
    /// Load data into WASM memory once. Builds row store + columnar store.
    #[wasm_bindgen(constructor)]
    pub fn new(data: JsValue) -> Result<DataEngine, JsValue> {
        let dataset = deserialize_dataset(data)?;
        let col_store = ColumnStore::from_rows(&dataset);
        Ok(DataEngine { data: dataset, col_store })
    }

    /// Run a pipeline. Scalar-returning ops use the columnar fast path;
    /// array-returning ops fall back to the row-based engine.
    pub fn query(&self, operations: JsValue, options: Option<JsValue>) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;

        let start = opts.offset.unwrap_or(0).min(self.col_store.len);
        let end = opts
            .limit
            .map(|l| (start + l).min(self.col_store.len))
            .unwrap_or(self.col_store.len);

        if let Some(result) = try_columnar(&self.col_store, &self.data, &ops, start, end) {
            return serialize_result(result.map_err(JsValue::from)?);
        }

        let result = execute_for_engine(&self.data, opts, ops).map_err(JsValue::from)?;
        serialize_result(result)
    }

    /// Return matching row indices as a Uint32Array instead of full rows.
    /// JS reconstructs: `Array.from(indices, i => data[i])`.
    /// Eliminates WASM→JS row serialization — fastest path for filter.
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
                self.col_store.filter_indices(&f.conditions, &f.logic, start, end)
            }
            _ => (start as u32..end as u32).collect(),
        };

        let arr = Uint32Array::new_with_length(indices.len() as u32);
        arr.copy_from(&indices);
        Ok(arr)
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

// ── shared helpers ─────────────────────────────────────────────────────────

fn deserialize_dataset(val: JsValue) -> Result<Dataset, JsValue> {
    let d = serde_wasm_bindgen::Deserializer::from(val);
    Dataset::deserialize(d).map_err(|e| {
        JsValue::from(JsError::new(&DataError::Deserialize(e.to_string()).to_string()))
    })
}

fn deserialize_ops(val: JsValue) -> Result<Vec<Operation>, JsValue> {
    let d = serde_wasm_bindgen::Deserializer::from(val);
    Vec::<Operation>::deserialize(d).map_err(|e| {
        JsValue::from(JsError::new(&DataError::Deserialize(e.to_string()).to_string()))
    })
}

fn deserialize_opts(val: Option<JsValue>) -> Result<PipelineOptions, JsValue> {
    match val {
        Some(v) if !v.is_undefined() && !v.is_null() => {
            let d = serde_wasm_bindgen::Deserializer::from(v);
            PipelineOptions::deserialize(d).map_err(|e| {
                JsValue::from(JsError::new(&DataError::Deserialize(e.to_string()).to_string()))
            })
        }
        _ => Ok(PipelineOptions::default()),
    }
}

fn serialize_result(result: impl Serialize) -> Result<JsValue, JsValue> {
    let serializer = Serializer::json_compatible();
    result.serialize(&serializer).map_err(|e: serde_wasm_bindgen::Error| {
        JsValue::from(JsError::new(&e.to_string()))
    })
}
