use crate::types::{ArithOp, DataError, MapExpr, MapOp, Row};
use serde_json::Value;

pub fn apply_map(data: &[Row], op: MapOp) -> Result<Vec<Row>, DataError> {
    data.iter()
        .map(|row| {
            let mut row = row.clone();
            for transform in &op.transforms {
                let new_val = eval_expr(&row, &transform.expr)?;
                row.insert(transform.field.clone(), new_val);
            }
            Ok(row)
        })
        .collect()
}

fn eval_expr(row: &Row, expr: &MapExpr) -> Result<Value, DataError> {
    match expr {
        MapExpr::Literal { value } => Ok(value.clone()),
        MapExpr::Field { name } => Ok(row.get(name).cloned().unwrap_or(Value::Null)),
        MapExpr::Template { template } => {
            let mut result = template.clone();
            for (k, v) in row {
                let placeholder = format!("{{{}}}", k);
                let replacement = match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                result = result.replace(&placeholder, &replacement);
            }
            Ok(Value::String(result))
        }
        MapExpr::Arithmetic { op, left, right } => {
            let l = eval_expr(row, left)?
                .as_f64()
                .ok_or_else(|| DataError::InvalidExpr("left operand not a number".into()))?;
            let r = eval_expr(row, right)?
                .as_f64()
                .ok_or_else(|| DataError::InvalidExpr("right operand not a number".into()))?;
            let result = match op {
                ArithOp::Add => l + r,
                ArithOp::Sub => l - r,
                ArithOp::Mul => l * r,
                ArithOp::Div => {
                    if r == 0.0 {
                        return Err(DataError::InvalidExpr("division by zero".into()));
                    }
                    l / r
                }
            };
            serde_json::Number::from_f64(result)
                .map(Value::Number)
                .ok_or_else(|| DataError::InvalidExpr("result is NaN or Infinity".into()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{FieldTransform, MapExpr, ArithOp};
    use serde_json::json;

    fn make_row(pairs: &[(&str, serde_json::Value)]) -> Row {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn extract_field() {
        let data = vec![make_row(&[("first", json!("Alice")), ("last", json!("Smith"))])];
        let op = MapOp {
            transforms: vec![FieldTransform {
                field: "name".into(),
                expr: MapExpr::Template { template: "{first} {last}".into() },
            }],
        };
        let result = apply_map(&data, op).unwrap();
        assert_eq!(result[0].get("name"), Some(&json!("Alice Smith")));
    }

    #[test]
    fn arithmetic_double() {
        let data = vec![make_row(&[("salary", json!(50000.0))])];
        let op = MapOp {
            transforms: vec![FieldTransform {
                field: "double_salary".into(),
                expr: MapExpr::Arithmetic {
                    op: ArithOp::Mul,
                    left: Box::new(MapExpr::Field { name: "salary".into() }),
                    right: Box::new(MapExpr::Literal { value: json!(2.0) }),
                },
            }],
        };
        let result = apply_map(&data, op).unwrap();
        assert_eq!(result[0].get("double_salary").and_then(|v| v.as_f64()), Some(100000.0));
    }
}
