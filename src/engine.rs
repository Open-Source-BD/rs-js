use crate::{
    operations::{
        count::apply_count, filter::apply_filter, find::apply_find,
        group_by::apply_group_by, map::apply_map, reduce::apply_reduce,
    },
    types::{DataError, Dataset, Operation, PipelineOptions, PipelineResult},
};

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

    pub fn execute(mut self, ops: Vec<Operation>) -> Result<PipelineResult, DataError> {
        if ops.is_empty() {
            return Err(DataError::EmptyPipeline);
        }

        let last_idx = ops.len() - 1;

        for (i, op) in ops.into_iter().enumerate() {
            let is_last = i == last_idx;
            match op {
                Operation::Filter(f) if !is_last => {
                    self.data = apply_filter(self.data, f)?;
                }
                Operation::Map(m) if !is_last => {
                    self.data = apply_map(self.data, m)?;
                }
                Operation::Filter(f) => {
                    return Ok(PipelineResult::Array(apply_filter(self.data, f)?));
                }
                Operation::Map(m) => {
                    return Ok(PipelineResult::Array(apply_map(self.data, m)?));
                }
                Operation::Reduce(r) => {
                    return Ok(PipelineResult::Number(apply_reduce(&self.data, r)?));
                }
                Operation::GroupBy(g) => {
                    return apply_group_by(self.data, g);
                }
                Operation::Count(c) => {
                    return Ok(PipelineResult::Number(apply_count(&self.data, c) as f64));
                }
                Operation::Find(f) => {
                    return Ok(PipelineResult::Item(apply_find(self.data, f)?));
                }
            }
        }

        Ok(PipelineResult::Array(self.data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Condition, ConditionLogic, CountOp, FilterOp, Operator, ReduceOp, Reducer};
    use serde_json::json;

    fn make_data() -> Dataset {
        vec![
            [("age", json!(20)), ("salary", json!(50000.0)), ("country", json!("US"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("age", json!(15)), ("salary", json!(0.0)), ("country", json!("UK"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("age", json!(30)), ("salary", json!(80000.0)), ("country", json!("US"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        ]
    }

    fn pipeline(data: Dataset) -> Pipeline {
        Pipeline::new(data, PipelineOptions::default())
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
        let result = pipeline(make_data()).execute(ops).unwrap();
        if let PipelineResult::Number(n) = result {
            assert_eq!(n, 2.0);
        } else {
            panic!("expected Number");
        }
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
        let result = pipeline(make_data()).execute(ops).unwrap();
        if let PipelineResult::Number(n) = result {
            assert_eq!(n, 130000.0);
        } else {
            panic!("expected Number");
        }
    }

    #[test]
    fn limit_option() {
        let p = Pipeline::new(make_data(), PipelineOptions { limit: Some(1), ..Default::default() });
        let ops = vec![Operation::Count(CountOp { field: None })];
        if let PipelineResult::Number(n) = p.execute(ops).unwrap() {
            assert_eq!(n, 1.0);
        }
    }
}
