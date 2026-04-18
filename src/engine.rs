use crate::{
    eval::evaluate_conditions,
    operations::{
        count::apply_count, find::apply_find, group_by::apply_group_by, map::apply_map,
        reduce::apply_reduce,
    },
    types::{DataError, Operation, PipelineOptions, PipelineResult, Row},
};

// ── Core engine: operates on &[Row] ──────────────────────────────────────────

/// Execute a pipeline on a borrowed slice.
/// Intermediate ops (filter, map) produce owned subsets only when needed.
/// Terminal ops (reduce, count, find, groupBy) read the slice directly.
pub fn execute_on_slice(data: &[Row], ops: Vec<Operation>) -> Result<PipelineResult, DataError> {
    if ops.is_empty() {
        return Err(DataError::EmptyPipeline);
    }

    // Tracks intermediate data.
    // None = still referencing the original slice (zero allocation).
    enum Working<'a> {
        Slice(&'a [Row]),
        Indices(Vec<usize>),
        Owned(Vec<Row>),
    }

    impl<'a> Working<'a> {
        fn into_owned(self, original: &[Row]) -> Vec<Row> {
            match self {
                Self::Slice(s) => s.to_vec(),
                Self::Indices(v) => v.into_iter().map(|i| original[i].clone()).collect(),
                Self::Owned(v) => v,
            }
        }
    }

    let mut working = Working::Slice(data);
    let last_idx = ops.len() - 1;

    for (i, op) in ops.into_iter().enumerate() {
        let is_last = i == last_idx;

        match op {
            Operation::Filter(f) => {
                let next_indices: Vec<usize> = match &working {
                    Working::Slice(s) => (0..s.len())
                        .filter(|&idx| evaluate_conditions(&s[idx], &f.conditions, &f.logic))
                        .collect(),
                    Working::Indices(v) => v
                        .iter()
                        .filter(|&&idx| evaluate_conditions(&data[idx], &f.conditions, &f.logic))
                        .cloned()
                        .collect(),
                    Working::Owned(v) => {
                        let filtered: Vec<Row> = v
                            .iter()
                            .filter(|row| evaluate_conditions(row, &f.conditions, &f.logic))
                            .cloned()
                            .collect();
                        if is_last {
                            return Ok(PipelineResult::Array(filtered));
                        }
                        working = Working::Owned(filtered);
                        continue;
                    }
                };
                if is_last {
                    return Ok(PipelineResult::Array(
                        next_indices
                            .into_iter()
                            .map(|idx: usize| data[idx].clone())
                            .collect(),
                    ));
                }
                working = Working::Indices(next_indices);
            }
            Operation::Map(m) => {
                let next_owned = match working {
                    Working::Slice(s) => apply_map(s, m)?,
                    Working::Indices(v) => {
                        let temp: Vec<Row> = v.into_iter().map(|idx| data[idx].clone()).collect();
                        apply_map(&temp, m)?
                    }
                    Working::Owned(v) => apply_map(&v, m)?,
                };
                if is_last {
                    return Ok(PipelineResult::Array(next_owned));
                }
                working = Working::Owned(next_owned);
            }
            Operation::Reduce(r) => {
                let val = match &working {
                    Working::Slice(s) => apply_reduce(s, r)?,
                    Working::Indices(v) => {
                        let nums: Vec<f64> = v
                            .iter()
                            .filter_map(|&idx| data[idx].get(&r.field)?.as_f64())
                            .collect();
                        match r.reducer {
                            crate::types::Reducer::Sum => nums.iter().sum(),
                            crate::types::Reducer::Avg => {
                                if nums.is_empty() {
                                    0.0
                                } else {
                                    nums.iter().sum::<f64>() / nums.len() as f64
                                }
                            }
                            crate::types::Reducer::Min => {
                                nums.iter().cloned().fold(f64::INFINITY, f64::min)
                            }
                            crate::types::Reducer::Max => {
                                nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
                            }
                            crate::types::Reducer::First => v
                                .iter()
                                .find_map(|&idx| data[idx].get(&r.field)?.as_f64())
                                .unwrap_or(0.0),
                            crate::types::Reducer::Last => v
                                .iter()
                                .rev()
                                .find_map(|&idx| data[idx].get(&r.field)?.as_f64())
                                .unwrap_or(0.0),
                        }
                    }
                    Working::Owned(v) => apply_reduce(v, r)?,
                };
                return Ok(PipelineResult::Number(val));
            }
            Operation::GroupBy(g) => {
                return match working {
                    Working::Slice(s) => apply_group_by(s, g),
                    Working::Indices(v) => {
                        let temp: Vec<Row> = v.into_iter().map(|idx| data[idx].clone()).collect();
                        apply_group_by(&temp, g)
                    }
                    Working::Owned(v) => apply_group_by(&v, g),
                };
            }
            Operation::Count(c) => {
                let count = match &working {
                    Working::Slice(s) => apply_count(s, c),
                    Working::Indices(v) => {
                        if let Some(f) = &c.field {
                            v.iter()
                                .filter(|&&idx| {
                                    data[idx]
                                        .get(f)
                                        .map_or(false, |v| !v.is_null() && v != &false)
                                })
                                .count()
                        } else {
                            v.len()
                        }
                    }
                    Working::Owned(v) => apply_count(v, c),
                };
                return Ok(PipelineResult::Number(count as f64));
            }
            Operation::Find(f) => {
                let item = match &working {
                    Working::Slice(s) => apply_find(s, f)?,
                    Working::Indices(v) => v
                        .iter()
                        .find(|&&idx| evaluate_conditions(&data[idx], &f.conditions, &f.logic))
                        .map(|&idx| data[idx].clone()),
                    Working::Owned(v) => apply_find(v, f)?,
                };
                return Ok(PipelineResult::Item(item));
            }
        }
    }

    Ok(PipelineResult::Array(working.into_owned(data)))
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
    use crate::types::{Condition, ConditionLogic, CountOp, Dataset, FilterOp, Operator, ReduceOp, Reducer};
    use serde_json::json;

    fn make_data() -> Dataset {
        vec![
            [
                ("age", json!(20)),
                ("salary", json!(50000.0)),
                ("country", json!("US")),
            ]
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
            [
                ("age", json!(15)),
                ("salary", json!(0.0)),
                ("country", json!("UK")),
            ]
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
            [
                ("age", json!(30)),
                ("salary", json!(80000.0)),
                ("country", json!("US")),
            ]
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
        ]
    }

    #[test]
    fn filter_then_count() {
        let ops = vec![
            Operation::Filter(FilterOp {
                conditions: vec![Condition {
                    field: "age".into(),
                    operator: Operator::Gte,
                    value: json!(18),
                }],
                logic: ConditionLogic::And,
            }),
            Operation::Count(CountOp { field: None }),
        ];
        if let PipelineResult::Number(n) = execute_on_slice(&make_data(), ops).unwrap() {
            assert_eq!(n, 2.0);
        } else {
            panic!("expected Number");
        }
    }

    #[test]
    fn filter_then_reduce() {
        let ops = vec![
            Operation::Filter(FilterOp {
                conditions: vec![Condition {
                    field: "age".into(),
                    operator: Operator::Gte,
                    value: json!(18),
                }],
                logic: ConditionLogic::And,
            }),
            Operation::Reduce(ReduceOp {
                field: "salary".into(),
                reducer: Reducer::Sum,
                alias: None,
            }),
        ];
        if let PipelineResult::Number(n) = execute_on_slice(&make_data(), ops).unwrap() {
            assert_eq!(n, 130000.0);
        } else {
            panic!("expected Number");
        }
    }

    #[test]
    fn limit_option() {
        let result = execute_for_engine(
            &make_data(),
            PipelineOptions {
                limit: Some(1),
                ..Default::default()
            },
            vec![Operation::Count(CountOp { field: None })],
        )
        .unwrap();
        if let PipelineResult::Number(n) = result {
            assert_eq!(n, 1.0);
        }
    }

    #[test]
    fn engine_reduce_zero_copy() {
        // reduce on full slice — should not clone any rows
        let data = make_data();
        let ops = vec![Operation::Reduce(ReduceOp {
            field: "salary".into(),
            reducer: Reducer::Sum,
            alias: None,
        })];
        if let PipelineResult::Number(n) = execute_on_slice(&data, ops).unwrap() {
            assert_eq!(n, 130000.0);
        }
    }
}
