mod engine;
mod eval;
mod operations;
mod types;

use engine::{execute_for_engine, Pipeline};
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
}

#[wasm_bindgen]
impl DataEngine {
    /// Load a JS array of objects into WASM memory. Pay serialization cost once.
    #[wasm_bindgen(constructor)]
    pub fn new(data: JsValue) -> Result<DataEngine, JsValue> {
        let dataset = deserialize_dataset(data)?;
        Ok(DataEngine { data: dataset })
    }

    /// Run a pipeline against the in-memory dataset. No re-serialization of data.
    pub fn query(&self, operations: JsValue, options: Option<JsValue>) -> Result<JsValue, JsValue> {
        let ops = deserialize_ops(operations)?;
        let opts = deserialize_opts(options)?;

        let result = execute_for_engine(&self.data, opts, ops)
            .map_err(JsValue::from)?;

        serialize_result(result)
    }

    /// Number of rows loaded.
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
