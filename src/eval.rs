use crate::types::{Condition, ConditionLogic, Operator, Row};
use serde_json::Value;

pub fn evaluate_conditions(row: &Row, conditions: &[Condition], logic: &ConditionLogic) -> bool {
    match logic {
        ConditionLogic::And => conditions.iter().all(|c| evaluate_one(row, c)),
        ConditionLogic::Or => conditions.iter().any(|c| evaluate_one(row, c)),
    }
}

fn evaluate_one(row: &Row, cond: &Condition) -> bool {
    let field_val = row.get(&cond.field);
    match &cond.operator {
        Operator::IsNull => field_val.map_or(true, |v| v.is_null()),
        Operator::IsNotNull => field_val.map_or(false, |v| !v.is_null()),
        op => match field_val {
            None => false,
            Some(fv) => compare(fv, op, &cond.value),
        },
    }
}

fn compare(fv: &Value, op: &Operator, cv: &Value) -> bool {
    match op {
        Operator::Eq => fv == cv,
        Operator::Ne => fv != cv,
        Operator::Gt => cmp_ordered(fv, cv).map_or(false, |o| o.is_gt()),
        Operator::Gte => cmp_ordered(fv, cv).map_or(false, |o| o.is_ge()),
        Operator::Lt => cmp_ordered(fv, cv).map_or(false, |o| o.is_lt()),
        Operator::Lte => cmp_ordered(fv, cv).map_or(false, |o| o.is_le()),
        Operator::Contains => str_op(fv, cv, |f, c| f.contains(c)),
        Operator::StartsWith => str_op(fv, cv, |f, c| f.starts_with(c)),
        Operator::EndsWith => str_op(fv, cv, |f, c| f.ends_with(c)),
        Operator::In => cv.as_array().map_or(false, |arr| arr.contains(fv)),
        Operator::NotIn => cv.as_array().map_or(true, |arr| !arr.contains(fv)),
        Operator::IsNull | Operator::IsNotNull => unreachable!(),
    }
}

fn cmp_ordered(a: &Value, b: &Value) -> Option<std::cmp::Ordering> {
    match (a, b) {
        (Value::Number(an), Value::Number(bn)) => an.as_f64()?.partial_cmp(&bn.as_f64()?),
        (Value::String(as_), Value::String(bs)) => as_.partial_cmp(bs),
        _ => None,
    }
}

fn str_op(fv: &Value, cv: &Value, f: impl Fn(&str, &str) -> bool) -> bool {
    match (fv, cv) {
        (Value::String(a), Value::String(b)) => f(a, b),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Condition, ConditionLogic, Operator};
    use serde_json::json;

    fn row(pairs: &[(&str, serde_json::Value)]) -> Row {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn test_eq() {
        let r = row(&[("age", json!(25))]);
        let cond = Condition { field: "age".into(), operator: Operator::Eq, value: json!(25) };
        assert!(evaluate_conditions(&r, &[cond], &ConditionLogic::And));
    }

    #[test]
    fn test_gte() {
        let r = row(&[("age", json!(18))]);
        let cond = Condition { field: "age".into(), operator: Operator::Gte, value: json!(18) };
        assert!(evaluate_conditions(&r, &[cond], &ConditionLogic::And));
    }

    #[test]
    fn test_contains() {
        let r = row(&[("name", json!("Alice"))]);
        let cond = Condition { field: "name".into(), operator: Operator::Contains, value: json!("lic") };
        assert!(evaluate_conditions(&r, &[cond], &ConditionLogic::And));
    }

    #[test]
    fn test_is_null() {
        let r = row(&[("x", json!(null))]);
        let cond = Condition { field: "x".into(), operator: Operator::IsNull, value: json!(null) };
        assert!(evaluate_conditions(&r, &[cond], &ConditionLogic::And));
    }

    #[test]
    fn test_in() {
        let r = row(&[("status", json!("active"))]);
        let cond = Condition {
            field: "status".into(),
            operator: Operator::In,
            value: json!(["active", "pending"]),
        };
        assert!(evaluate_conditions(&r, &[cond], &ConditionLogic::And));
    }
}
