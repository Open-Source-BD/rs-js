use crate::{
    eval::evaluate_conditions,
    types::{DataError, Dataset, FilterOp},
};

pub fn apply_filter(data: Dataset, op: FilterOp) -> Result<Dataset, DataError> {
    Ok(data
        .into_iter()
        .filter(|row| evaluate_conditions(row, &op.conditions, &op.logic))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Condition, ConditionLogic, Operator};
    use serde_json::json;

    fn make_data() -> Dataset {
        vec![
            [("age", json!(20)), ("name", json!("Alice"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("age", json!(15)), ("name", json!("Bob"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("age", json!(30)), ("name", json!("Carol"))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        ]
    }

    #[test]
    fn filter_gte() {
        let op = FilterOp {
            conditions: vec![Condition { field: "age".into(), operator: Operator::Gte, value: json!(18) }],
            logic: ConditionLogic::And,
        };
        let result = apply_filter(make_data(), op).unwrap();
        assert_eq!(result.len(), 2);
    }
}
