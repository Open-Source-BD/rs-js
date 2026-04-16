mod engine;
mod eval;
mod operations;
mod types;

use engine::Pipeline;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::Serializer;
use types::{DataError, Dataset, Operation, PipelineOptions};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen(js_name = "processRaw")]
pub fn process_raw(
    data: JsValue,
    operations: JsValue,
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let data_deser = serde_wasm_bindgen::Deserializer::from(data);
    let dataset = Dataset::deserialize(data_deser)
        .map_err(|e| DataError::Deserialize(e.to_string()))?;

    let ops_deser = serde_wasm_bindgen::Deserializer::from(operations);
    let ops = Vec::<Operation>::deserialize(ops_deser)
        .map_err(|e| DataError::Deserialize(e.to_string()))?;

    let opts: PipelineOptions = match options {
        Some(v) if !v.is_undefined() && !v.is_null() => {
            let d = serde_wasm_bindgen::Deserializer::from(v);
            PipelineOptions::deserialize(d)
                .map_err(|e| DataError::Deserialize(e.to_string()))?
        }
        _ => PipelineOptions::default(),
    };

    let result = Pipeline::new(dataset, opts)
        .execute(ops)
        .map_err(JsValue::from)?;

    let serializer = Serializer::json_compatible();
    result
        .serialize(&serializer)
        .map_err(|e: serde_wasm_bindgen::Error| JsValue::from(wasm_bindgen::JsError::new(&e.to_string())))
}
