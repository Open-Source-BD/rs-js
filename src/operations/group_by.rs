use crate::{
    operations::reduce::apply_reduce,
    types::{DataError, Dataset, GroupByOp, PipelineResult, Row},
};
use indexmap::IndexMap;
use serde_json::Value;

pub fn apply_group_by(data: Dataset, op: GroupByOp) -> Result<PipelineResult, DataError> {
    let mut groups: IndexMap<String, Vec<Row>> = IndexMap::new();

    for row in data {
        let key = op
            .field
            .iter()
            .map(|f| {
                row.get(f).map_or_else(|| "null".to_string(), |v| match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
            })
            .collect::<Vec<_>>()
            .join("||");
        groups.entry(key).or_default().push(row);
    }

    if op.aggregate.is_empty() {
        let result: Vec<Row> = groups
            .into_iter()
            .map(|(key, rows)| {
                let mut group_row: Row = IndexMap::new();
                group_row.insert("_group".into(), Value::String(key));
                group_row.insert("_count".into(), Value::Number(rows.len().into()));
                if let Some(first) = rows.first() {
                    for field in &op.field {
                        if let Some(v) = first.get(field) {
                            group_row.insert(field.clone(), v.clone());
                        }
                    }
                }
                group_row.insert(
                    "rows".into(),
                    Value::Array(
                        rows.into_iter()
                            .map(|r| Value::Object(r.into_iter().collect()))
                            .collect(),
                    ),
                );
                group_row
            })
            .collect();
        return Ok(PipelineResult::Array(result));
    }

    let mut out: IndexMap<String, Value> = IndexMap::new();
    for (key, rows) in groups {
        let mut agg: serde_json::Map<String, Value> = serde_json::Map::new();
        agg.insert("_count".into(), Value::Number(rows.len().into()));
        for reduce_op in &op.aggregate {
            let alias = reduce_op.alias.clone().unwrap_or_else(|| {
                format!("{}_{}", format!("{:?}", reduce_op.reducer).to_lowercase(), reduce_op.field)
            });
            let val = apply_reduce(&rows, reduce_op.clone())?;
            let num = serde_json::Number::from_f64(val)
                .unwrap_or_else(|| serde_json::Number::from(0));
            agg.insert(alias, Value::Number(num));
        }
        out.insert(key, Value::Object(agg));
    }
    Ok(PipelineResult::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_data() -> Dataset {
        vec![
            [("country", json!("US")), ("salary", json!(100.0))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("country", json!("UK")), ("salary", json!(80.0))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            [("country", json!("US")), ("salary", json!(120.0))].iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
        ]
    }

    #[test]
    fn group_no_agg() {
        let op = GroupByOp { field: vec!["country".into()], aggregate: vec![] };
        let result = apply_group_by(make_data(), op).unwrap();
        if let PipelineResult::Array(rows) = result {
            assert_eq!(rows.len(), 2);
        } else {
            panic!("expected Array");
        }
    }

    #[test]
    fn group_with_agg() {
        use crate::types::{ReduceOp, Reducer};
        let op = GroupByOp {
            field: vec!["country".into()],
            aggregate: vec![ReduceOp { field: "salary".into(), reducer: Reducer::Sum, alias: Some("total".into()) }],
        };
        let result = apply_group_by(make_data(), op).unwrap();
        if let PipelineResult::Object(map) = result {
            assert_eq!(map.len(), 2);
            let us = map.get("US").unwrap().as_object().unwrap();
            assert_eq!(us.get("total").and_then(|v| v.as_f64()), Some(220.0));
        } else {
            panic!("expected Object");
        }
    }
}
