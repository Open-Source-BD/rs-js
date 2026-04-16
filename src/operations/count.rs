use crate::types::{CountOp, Dataset};
use serde_json::Value;

pub fn apply_count(data: &Dataset, op: CountOp) -> usize {
    match op.field {
        None => data.len(),
        Some(field) => data.iter().filter(|row| {
            row.get(&field)
                .map_or(false, |v| !v.is_null() && *v != Value::Bool(false))
        }).count(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_data() -> Dataset {
        vec![
            [("active", json!(true))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("active", json!(false))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("active", json!(true))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        ]
    }

    #[test]
    fn count_all() {
        let op = CountOp { field: None };
        assert_eq!(apply_count(&make_data(), op), 3);
    }

    #[test]
    fn count_truthy_field() {
        let op = CountOp { field: Some("active".into()) };
        assert_eq!(apply_count(&make_data(), op), 2);
    }
}
