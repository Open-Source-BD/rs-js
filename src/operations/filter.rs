#[cfg(test)]
mod tests {
    use crate::engine::execute_on_slice;
    use crate::types::{Condition, ConditionLogic, FilterOp, Operation, Operator, PipelineResult, Row};
    use serde_json::json;

    fn make_data() -> Vec<Row> {
        vec![
            [("age", json!(20)), ("name", json!("Alice"))]
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            [("age", json!(15)), ("name", json!("Bob"))]
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            [("age", json!(30)), ("name", json!("Carol"))]
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        ]
    }

    #[test]
    fn filter_gte() {
        let ops = vec![Operation::Filter(FilterOp {
            conditions: vec![Condition {
                field: "age".into(),
                operator: Operator::Gte,
                value: json!(18),
            }],
            logic: ConditionLogic::And,
        })];
        match execute_on_slice(&make_data(), ops).unwrap() {
            PipelineResult::Array(rows) => assert_eq!(rows.len(), 2),
            _ => panic!("expected Array"),
        }
    }
}
