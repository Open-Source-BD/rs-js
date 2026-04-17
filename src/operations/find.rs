use crate::{
    eval::evaluate_conditions,
    types::{DataError, FindOp, Row},
};

pub fn apply_find(data: &[Row], op: FindOp) -> Result<Option<Row>, DataError> {
    Ok(data
        .iter()
        .find(|row| evaluate_conditions(row, &op.conditions, &op.logic))
        .cloned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Condition, ConditionLogic, Operator};
    use serde_json::json;

    #[test]
    fn find_by_id() {
        let data: Vec<Row> = vec![
            [("id", json!(1)), ("name", json!("Alice"))]
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            [("id", json!(2)), ("name", json!("Bob"))]
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        ];
        let op = FindOp {
            conditions: vec![Condition {
                field: "id".into(),
                operator: Operator::Eq,
                value: json!(2),
            }],
            logic: ConditionLogic::And,
        };
        let result = apply_find(&data, op).unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().get("name"), Some(&json!("Bob")));
    }

    #[test]
    fn find_missing() {
        let data: Vec<Row> = vec![
            [("id", json!(1))]
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        ];
        let op = FindOp {
            conditions: vec![Condition {
                field: "id".into(),
                operator: Operator::Eq,
                value: json!(99),
            }],
            logic: ConditionLogic::And,
        };
        assert!(apply_find(&data, op).unwrap().is_none());
    }
}
