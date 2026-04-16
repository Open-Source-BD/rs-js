use crate::{
    operations::{
        count::apply_count, filter::apply_filter, find::apply_find,
        group_by::apply_group_by, map::apply_map, reduce::apply_reduce,
    },
    types::{DataError, Dataset, Operation, PipelineOptions, PipelineResult, Row},
};

// ── Legacy path: process_raw() passes owned Dataset ──────────────────────────

pub struct Pipeline {
    data: Dataset,
}

impl Pipeline {
    pub fn new(mut data: Dataset, opts: PipelineOptions) -> Self {
        if let Some(offset) = opts.offset {
            data = data.into_iter().skip(offset).collect();
        }
        if let Some(limit) = opts.limit {
            data.truncate(limit);
        }
        Self { data }
    }

    pub fn execute(self, ops: Vec<Operation>) -> Result<PipelineResult, DataError> {
        execute_on_slice(&self.data, ops)
    }
}

// ── Core engine: operates on &[Row] — used by both Pipeline and DataEngine ───

/// Execute a pipeline on a borrowed slice.
/// Intermediate ops (filter, map) produce owned subsets only when needed.
/// Terminal ops (reduce, count, find, groupBy) read the slice directly.
pub fn execute_on_slice(data: &[Row], ops: Vec<Operation>) -> Result<PipelineResult, DataError> {
    if ops.is_empty() {
        return Err(DataError::EmptyPipeline);
    }

    // Tracks intermediate owned data produced by filter/map.
    // None = still referencing the original slice (zero allocation).
    enum Working<'a> {
        Slice(&'a [Row]),
        Owned(Vec<Row>),
    }

    impl<'a> Working<'a> {
        fn as_slice(&self) -> &[Row] {
            match self {
                Self::Slice(s) => s,
                Self::Owned(v) => v.as_slice(),
            }
        }
        fn into_owned(self) -> Vec<Row> {
            match self {
                Self::Slice(s) => s.to_vec(),
                Self::Owned(v) => v,
            }
        }
    }

    let mut working = Working::Slice(data);
    let last_idx = ops.len() - 1;

    for (i, op) in ops.into_iter().enumerate() {
        let is_last = i == last_idx;
        let current = working.as_slice();

        match op {
            Operation::Filter(f) if !is_last => {
                working = Working::Owned(apply_filter(current, f)?);
            }
            Operation::Map(m) if !is_last => {
                working = Working::Owned(apply_map(current, m)?);
            }
            Operation::Filter(f) => {
                return Ok(PipelineResult::Array(apply_filter(current, f)?));
            }
            Operation::Map(m) => {
                return Ok(PipelineResult::Array(apply_map(current, m)?));
            }
            Operation::Reduce(r) => {
                return Ok(PipelineResult::Number(apply_reduce(current, r)?));
            }
            Operation::GroupBy(g) => {
                return apply_group_by(current, g);
            }
            Operation::Count(c) => {
                return Ok(PipelineResult::Number(apply_count(current, c) as f64));
            }
            Operation::Find(f) => {
                return Ok(PipelineResult::Item(apply_find(current, f)?));
            }
        }
    }

    Ok(PipelineResult::Array(working.into_owned()))
}

// ── DataEngine: offset/limit applied before entering execute_on_slice ─────────

pub fn execute_for_engine(
    data: &[Row],
    opts: PipelineOptions,
    ops: Vec<Operation>,
) -> Result<PipelineResult, DataError> {
    let start = opts.offset.unwrap_or(0).min(data.len());
    let end = opts
        .limit
        .map(|l| (start + l).min(data.len()))
        .unwrap_or(data.len());
    execute_on_slice(&data[start..end], ops)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Condition, ConditionLogic, CountOp, FilterOp, Operator, ReduceOp, Reducer};
    use serde_json::json;

    fn make_data() -> Dataset {
        vec![
            [("age", json!(20)), ("salary", json!(50000.0)), ("country", json!("US"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("age", json!(15)), ("salary", json!(0.0)),     ("country", json!("UK"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("age", json!(30)), ("salary", json!(80000.0)), ("country", json!("US"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        ]
    }

    #[test]
    fn filter_then_count() {
        let ops = vec![
            Operation::Filter(FilterOp {
                conditions: vec![Condition { field: "age".into(), operator: Operator::Gte, value: json!(18) }],
                logic: ConditionLogic::And,
            }),
            Operation::Count(CountOp { field: None }),
        ];
        if let PipelineResult::Number(n) = execute_on_slice(&make_data(), ops).unwrap() {
            assert_eq!(n, 2.0);
        } else { panic!("expected Number"); }
    }

    #[test]
    fn filter_then_reduce() {
        let ops = vec![
            Operation::Filter(FilterOp {
                conditions: vec![Condition { field: "age".into(), operator: Operator::Gte, value: json!(18) }],
                logic: ConditionLogic::And,
            }),
            Operation::Reduce(ReduceOp { field: "salary".into(), reducer: Reducer::Sum, alias: None }),
        ];
        if let PipelineResult::Number(n) = execute_on_slice(&make_data(), ops).unwrap() {
            assert_eq!(n, 130000.0);
        } else { panic!("expected Number"); }
    }

    #[test]
    fn limit_option() {
        let result = execute_for_engine(
            &make_data(),
            PipelineOptions { limit: Some(1), ..Default::default() },
            vec![Operation::Count(CountOp { field: None })],
        ).unwrap();
        if let PipelineResult::Number(n) = result {
            assert_eq!(n, 1.0);
        }
    }

    #[test]
    fn engine_reduce_zero_copy() {
        // reduce on full slice — should not clone any rows
        let data = make_data();
        let ops = vec![
            Operation::Reduce(ReduceOp { field: "salary".into(), reducer: Reducer::Sum, alias: None }),
        ];
        if let PipelineResult::Number(n) = execute_on_slice(&data, ops).unwrap() {
            assert_eq!(n, 130000.0);
        }
    }
}
