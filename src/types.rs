use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub type Row = IndexMap<String, Value>;
pub type Dataset = Vec<Row>;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Operation {
    Filter(FilterOp),
    Map(MapOp),
    Reduce(ReduceOp),
    GroupBy(GroupByOp),
    Count(CountOp),
    Find(FindOp),
}

// --- Filter / Find conditions ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterOp {
    pub conditions: Vec<Condition>,
    #[serde(default = "default_logic")]
    pub logic: ConditionLogic,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindOp {
    pub conditions: Vec<Condition>,
    #[serde(default = "default_logic")]
    pub logic: ConditionLogic,
}

fn default_logic() -> ConditionLogic {
    ConditionLogic::And
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConditionLogic {
    #[default]
    And,
    Or,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub field: String,
    pub operator: Operator,
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operator {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    StartsWith,
    EndsWith,
    In,
    NotIn,
    IsNull,
    IsNotNull,
}

// --- Map ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapOp {
    pub transforms: Vec<FieldTransform>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldTransform {
    pub field: String,
    pub expr: MapExpr,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MapExpr {
    Literal {
        value: Value,
    },
    Field {
        name: String,
    },
    Template {
        template: String,
    },
    Arithmetic {
        op: ArithOp,
        left: Box<MapExpr>,
        right: Box<MapExpr>,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub enum ArithOp {
    #[serde(rename = "+")]
    Add,
    #[serde(rename = "-")]
    Sub,
    #[serde(rename = "*")]
    Mul,
    #[serde(rename = "/")]
    Div,
}

// --- Reduce ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReduceOp {
    pub field: String,
    pub reducer: Reducer,
    #[serde(default)]
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reducer {
    Sum,
    Avg,
    Min,
    Max,
    First,
    Last,
}

// --- GroupBy ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupByOp {
    #[serde(deserialize_with = "string_or_vec")]
    pub field: Vec<String>,
    #[serde(default)]
    pub aggregate: Vec<ReduceOp>,
}

fn string_or_vec<'de, D>(d: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::{self, SeqAccess, Visitor};

    struct SoV;
    impl<'de> Visitor<'de> for SoV {
        type Value = Vec<String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("string or array of strings")
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<Vec<String>, E> {
            Ok(vec![v.to_owned()])
        }
        fn visit_string<E: de::Error>(self, v: String) -> Result<Vec<String>, E> {
            Ok(vec![v])
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<String>, A::Error> {
            let mut v = Vec::new();
            while let Some(s) = seq.next_element::<String>()? {
                v.push(s);
            }
            Ok(v)
        }
    }
    d.deserialize_any(SoV)
}

// --- Count ---

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountOp {
    #[serde(default)]
    pub field: Option<String>,
}

// --- PipelineOptions ---

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PipelineOptions {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub include_meta: bool,
}

// --- PipelineResult ---

#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum PipelineResult {
    Array(Vec<Row>),
    Number(f64),
    Object(IndexMap<String, Value>),
    Item(Option<Row>),
}

// --- DataError ---

#[derive(Debug, Error)]
pub enum DataError {
    #[error("deserialization failed: {0}")]
    Deserialize(String),
    #[error("operation '{op}' on field '{field}': {reason}")]
    Operation {
        op: String,
        field: String,
        reason: String,
    },
    #[error("type mismatch on field '{field}': expected {expected}, got {got}")]
    TypeMismatch {
        field: String,
        expected: String,
        got: String,
    },
    #[error("invalid expression: {0}")]
    InvalidExpr(String),
    #[error("empty pipeline")]
    EmptyPipeline,
}

impl From<DataError> for wasm_bindgen::JsValue {
    fn from(e: DataError) -> Self {
        wasm_bindgen::JsError::new(&e.to_string()).into()
    }
}
