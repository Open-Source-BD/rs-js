use crate::types::{DataError, Dataset, ReduceOp, Reducer};

pub fn apply_reduce(data: &Dataset, op: ReduceOp) -> Result<f64, DataError> {
    let nums: Vec<f64> = data
        .iter()
        .filter_map(|row| row.get(&op.field)?.as_f64())
        .collect();

    if nums.is_empty() {
        return match op.reducer {
            Reducer::Min | Reducer::Max => Err(DataError::Operation {
                op: "reduce".into(),
                field: op.field.clone(),
                reason: "no numeric values found".into(),
            }),
            _ => Ok(0.0),
        };
    }

    Ok(match op.reducer {
        Reducer::Sum => nums.iter().sum(),
        Reducer::Avg => nums.iter().sum::<f64>() / nums.len() as f64,
        Reducer::Min => nums.iter().cloned().fold(f64::INFINITY, f64::min),
        Reducer::Max => nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
        Reducer::First => data
            .iter()
            .find_map(|r| r.get(&op.field)?.as_f64())
            .unwrap_or(0.0),
        Reducer::Last => data
            .iter()
            .rev()
            .find_map(|r| r.get(&op.field)?.as_f64())
            .unwrap_or(0.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn data_with_amounts(amounts: &[f64]) -> Dataset {
        amounts
            .iter()
            .map(|&a| {
                [("amount", json!(a))]
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.clone()))
                    .collect()
            })
            .collect()
    }

    #[test]
    fn sum() {
        let op = ReduceOp { field: "amount".into(), reducer: Reducer::Sum, alias: None };
        assert_eq!(apply_reduce(&data_with_amounts(&[10.0, 20.0, 30.0]), op).unwrap(), 60.0);
    }

    #[test]
    fn avg() {
        let op = ReduceOp { field: "amount".into(), reducer: Reducer::Avg, alias: None };
        assert_eq!(apply_reduce(&data_with_amounts(&[10.0, 20.0, 30.0]), op).unwrap(), 20.0);
    }

    #[test]
    fn min_max() {
        let data = data_with_amounts(&[5.0, 1.0, 9.0]);
        let min_op = ReduceOp { field: "amount".into(), reducer: Reducer::Min, alias: None };
        let max_op = ReduceOp { field: "amount".into(), reducer: Reducer::Max, alias: None };
        assert_eq!(apply_reduce(&data, min_op).unwrap(), 1.0);
        assert_eq!(apply_reduce(&data, max_op).unwrap(), 9.0);
    }
}
