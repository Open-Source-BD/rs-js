use crate::types::{
    Condition, ConditionLogic, DataError, GroupByOp, Operation, Operator, PipelineResult,
    ReduceOp, Reducer, Row,
};
use indexmap::IndexMap;
use serde_json::Value;

// ── Column representation ─────────────────────────────────────────────────────

pub(crate) enum Col {
    F64(Vec<f64>),            // f64::NAN = null / missing
    Bool(Vec<u8>),            // 0 = false · 1 = true · 255 = null
    Str(Vec<Option<String>>), // None = null
}

// ── Store ─────────────────────────────────────────────────────────────────────

pub(crate) struct ColumnStore {
    cols: IndexMap<String, Col>,
    pub len: usize,
}

impl ColumnStore {
    pub fn from_rows(rows: &[Row]) -> Self {
        let len = rows.len();
        if len == 0 {
            return Self { cols: IndexMap::new(), len: 0 };
        }
        let cols = rows[0]
            .keys()
            .map(|name| (name.clone(), build_col(rows, name)))
            .collect();
        Self { cols, len }
    }

    // ── count ─────────────────────────────────────────────────────────────────

    pub fn count(
        &self,
        filter: Option<(&[Condition], &ConditionLogic)>,
        truthy_field: Option<&str>,
        start: usize,
        end: usize,
    ) -> usize {
        let resolved = filter.map(|(conds, logic)| (resolve(&self.cols, conds), logic));

        (start..end)
            .filter(|&i| {
                if let Some((ref res, logic)) = resolved {
                    if !eval_all(res, i, logic) {
                        return false;
                    }
                }
                if let Some(f) = truthy_field {
                    match self.cols.get(f) {
                        Some(Col::Bool(v)) => v[i] == 1,
                        Some(Col::F64(v)) => !v[i].is_nan(),
                        Some(Col::Str(v)) => v[i].is_some(),
                        None => false,
                    }
                } else {
                    true
                }
            })
            .count()
    }

    // ── reduce ────────────────────────────────────────────────────────────────

    pub fn reduce(
        &self,
        filter: Option<(&[Condition], &ConditionLogic)>,
        op: &ReduceOp,
        start: usize,
        end: usize,
    ) -> Result<f64, DataError> {
        let Some(Col::F64(col)) = self.cols.get(&op.field) else {
            return Err(DataError::Operation {
                op: "reduce".into(),
                field: op.field.clone(),
                reason: "not a numeric column in columnar store".into(),
            });
        };

        let resolved = filter.map(|(conds, logic)| (resolve(&self.cols, conds), logic));
        let passes = |i: usize| -> bool {
            match &resolved {
                None => true,
                Some((res, logic)) => eval_all(res, i, logic),
            }
        };

        match op.reducer {
            Reducer::First => {
                return Ok((start..end)
                    .find(|&i| passes(i) && !col[i].is_nan())
                    .map(|i| col[i])
                    .unwrap_or(0.0));
            }
            Reducer::Last => {
                return Ok((start..end)
                    .rev()
                    .find(|&i| passes(i) && !col[i].is_nan())
                    .map(|i| col[i])
                    .unwrap_or(0.0));
            }
            _ => {}
        }

        let mut sum = 0.0_f64;
        let mut cnt = 0_usize;
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;

        for i in start..end {
            if passes(i) {
                let v = col[i];
                if !v.is_nan() {
                    sum += v;
                    cnt += 1;
                    if v < min { min = v; }
                    if v > max { max = v; }
                }
            }
        }

        if cnt == 0 {
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
            Reducer::Sum => sum,
            Reducer::Avg => sum / cnt as f64,
            Reducer::Min => min,
            Reducer::Max => max,
            Reducer::First | Reducer::Last => unreachable!(),
        })
    }

    // ── find ─────────────────────────────────────────────────────────────────

    pub fn find_index(
        &self,
        conds: &[Condition],
        logic: &ConditionLogic,
        start: usize,
        end: usize,
    ) -> Option<usize> {
        let resolved = resolve(&self.cols, conds);
        (start..end).find(|&i| eval_all(&resolved, i, logic))
    }

    // ── filter → indices ──────────────────────────────────────────────────────

    pub fn filter_indices(
        &self,
        conds: &[Condition],
        logic: &ConditionLogic,
        start: usize,
        end: usize,
    ) -> Vec<u32> {
        let resolved = resolve(&self.cols, conds);
        (start..end)
            .filter(|&i| eval_all(&resolved, i, logic))
            .map(|i| i as u32)
            .collect()
    }

    // ── groupBy with aggregates ───────────────────────────────────────────────

    pub fn group_by_agg(
        &self,
        op: &GroupByOp,
        filter: Option<(&[Condition], &ConditionLogic)>,
        start: usize,
        end: usize,
    ) -> Result<PipelineResult, DataError> {
        let resolved = filter.map(|(conds, logic)| (resolve(&self.cols, conds), logic));
        let mut groups: IndexMap<String, Vec<usize>> = IndexMap::new();

        for i in start..end {
            if let Some((ref res, logic)) = resolved {
                if !eval_all(res, i, logic) {
                    continue;
                }
            }
            let key = op
                .field
                .iter()
                .map(|f| col_val_str(&self.cols, f, i))
                .collect::<Vec<_>>()
                .join("||");
            groups.entry(key).or_default().push(i);
        }

        let mut out: IndexMap<String, Value> = IndexMap::new();
        for (key, indices) in groups {
            let mut agg: serde_json::Map<String, Value> = serde_json::Map::new();
            agg.insert("_count".into(), Value::Number(indices.len().into()));
            for reduce_op in &op.aggregate {
                let alias = reduce_op.alias.clone().unwrap_or_else(|| {
                    format!(
                        "{}_{}",
                        format!("{:?}", reduce_op.reducer).to_lowercase(),
                        reduce_op.field
                    )
                });
                let val = self.reduce_on_indices(reduce_op, &indices)?;
                let num = serde_json::Number::from_f64(val).unwrap_or_else(|| 0.into());
                agg.insert(alias, Value::Number(num));
            }
            out.insert(key, Value::Object(agg));
        }

        Ok(PipelineResult::Object(out))
    }

    fn reduce_on_indices(&self, op: &ReduceOp, indices: &[usize]) -> Result<f64, DataError> {
        let Some(Col::F64(col)) = self.cols.get(&op.field) else {
            return Ok(0.0);
        };

        match op.reducer {
            Reducer::First => {
                return Ok(indices
                    .iter()
                    .find_map(|&i| {
                        let v = col[i];
                        if v.is_nan() { None } else { Some(v) }
                    })
                    .unwrap_or(0.0));
            }
            Reducer::Last => {
                return Ok(indices
                    .iter()
                    .rev()
                    .find_map(|&i| {
                        let v = col[i];
                        if v.is_nan() { None } else { Some(v) }
                    })
                    .unwrap_or(0.0));
            }
            _ => {}
        }

        let mut sum = 0.0_f64;
        let mut cnt = 0_usize;
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;

        for &i in indices {
            let v = col[i];
            if !v.is_nan() {
                sum += v;
                cnt += 1;
                if v < min { min = v; }
                if v > max { max = v; }
            }
        }

        if cnt == 0 {
            return match op.reducer {
                Reducer::Min | Reducer::Max => Err(DataError::Operation {
                    op: "reduce".into(),
                    field: op.field.clone(),
                    reason: "no numeric values in group".into(),
                }),
                _ => Ok(0.0),
            };
        }

        Ok(match op.reducer {
            Reducer::Sum => sum,
            Reducer::Avg => sum / cnt as f64,
            Reducer::Min => min,
            Reducer::Max => max,
            Reducer::First | Reducer::Last => unreachable!(),
        })
    }
}

// ── Column construction ───────────────────────────────────────────────────────

fn build_col(rows: &[Row], field: &str) -> Col {
    let mut seen_num = false;
    let mut seen_bool = false;
    let mut seen_other = false;

    for row in rows {
        match row.get(field) {
            Some(Value::Number(_)) => {
                if seen_bool { seen_other = true; break; }
                seen_num = true;
            }
            Some(Value::Bool(_)) => {
                if seen_num { seen_other = true; break; }
                seen_bool = true;
            }
            Some(Value::Null) | None => {}
            _ => { seen_other = true; break; }
        }
    }

    if seen_other {
        Col::Str(rows.iter().map(|r| match r.get(field) {
            Some(Value::String(s)) => Some(s.clone()),
            Some(v) if !v.is_null() => Some(v.to_string()),
            _ => None,
        }).collect())
    } else if seen_bool {
        Col::Bool(rows.iter().map(|r| match r.get(field) {
            Some(Value::Bool(true)) => 1u8,
            Some(Value::Bool(false)) => 0u8,
            _ => 255u8,
        }).collect())
    } else {
        Col::F64(rows.iter().map(|r| match r.get(field) {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
            _ => f64::NAN,
        }).collect())
    }
}

// ── Condition resolution (eliminate hash lookups from the scan loop) ──────────

enum ResolvedCond<'a> {
    F64 { col: &'a [f64], op: &'a Operator, threshold: f64, raw: &'a Value },
    Bool { col: &'a [u8], op: &'a Operator, threshold: u8 },
    Str { col: &'a [Option<String>], op: &'a Operator, raw: &'a Value },
    Missing,
}

fn resolve<'a>(cols: &'a IndexMap<String, Col>, conds: &'a [Condition]) -> Vec<ResolvedCond<'a>> {
    conds
        .iter()
        .map(|c| match cols.get(&c.field) {
            Some(Col::F64(v)) => ResolvedCond::F64 {
                col: v.as_slice(),
                op: &c.operator,
                threshold: c.value.as_f64().unwrap_or(f64::NAN),
                raw: &c.value,
            },
            Some(Col::Bool(v)) => ResolvedCond::Bool {
                col: v.as_slice(),
                op: &c.operator,
                threshold: match &c.value {
                    Value::Bool(true) => 1,
                    Value::Bool(false) => 0,
                    _ => 255,
                },
            },
            Some(Col::Str(v)) => ResolvedCond::Str {
                col: v.as_slice(),
                op: &c.operator,
                raw: &c.value,
            },
            None => ResolvedCond::Missing,
        })
        .collect()
}

#[inline]
fn eval_all(resolved: &[ResolvedCond], i: usize, logic: &ConditionLogic) -> bool {
    match logic {
        ConditionLogic::And => resolved.iter().all(|rc| eval_one(rc, i)),
        ConditionLogic::Or => resolved.iter().any(|rc| eval_one(rc, i)),
    }
}

#[inline]
fn eval_one(rc: &ResolvedCond, i: usize) -> bool {
    match rc {
        ResolvedCond::F64 { col, op, threshold, raw } => {
            let v = col[i];
            match op {
                Operator::IsNull => v.is_nan(),
                Operator::IsNotNull => !v.is_nan(),
                _ if v.is_nan() => false,
                Operator::Eq => v == *threshold,
                Operator::Ne => v != *threshold,
                Operator::Gt => v > *threshold,
                Operator::Gte => v >= *threshold,
                Operator::Lt => v < *threshold,
                Operator::Lte => v <= *threshold,
                Operator::In => raw
                    .as_array()
                    .map_or(false, |arr| arr.iter().any(|x| x.as_f64().map_or(false, |x| x == v))),
                Operator::NotIn => raw
                    .as_array()
                    .map_or(true, |arr| !arr.iter().any(|x| x.as_f64().map_or(false, |x| x == v))),
                _ => false,
            }
        }
        ResolvedCond::Bool { col, op, threshold } => {
            let v = col[i];
            match op {
                Operator::IsNull => v == 255,
                Operator::IsNotNull => v != 255,
                _ if v == 255 => false,
                Operator::Eq => v == *threshold,
                Operator::Ne => v != *threshold,
                _ => false,
            }
        }
        ResolvedCond::Str { col, op, raw } => match &col[i] {
            None => matches!(op, Operator::IsNull),
            Some(s) => eval_str(s.as_str(), op, raw),
        },
        ResolvedCond::Missing => false,
    }
}

fn eval_str(s: &str, op: &Operator, raw: &Value) -> bool {
    match op {
        Operator::IsNull => false,
        Operator::IsNotNull => true,
        Operator::Eq => raw.as_str().map_or(false, |r| s == r),
        Operator::Ne => raw.as_str().map_or(true, |r| s != r),
        Operator::Contains => raw.as_str().map_or(false, |r| s.contains(r)),
        Operator::StartsWith => raw.as_str().map_or(false, |r| s.starts_with(r)),
        Operator::EndsWith => raw.as_str().map_or(false, |r| s.ends_with(r)),
        Operator::In => raw
            .as_array()
            .map_or(false, |arr| arr.iter().any(|x| x.as_str().map_or(false, |r| r == s))),
        Operator::NotIn => raw
            .as_array()
            .map_or(true, |arr| !arr.iter().any(|x| x.as_str().map_or(false, |r| r == s))),
        _ => false,
    }
}

// ── Columnar routing — called by DataEngine::query() ─────────────────────────

pub(crate) fn try_columnar(
    store: &ColumnStore,
    rows: &[Row],
    ops: &[Operation],
    start: usize,
    end: usize,
) -> Option<Result<PipelineResult, DataError>> {
    use Operation::*;
    match ops {
        [Count(c)] => Some(Ok(PipelineResult::Number(
            store.count(None, c.field.as_deref(), start, end) as f64,
        ))),
        [Filter(f), Count(c)] => Some(Ok(PipelineResult::Number(
            store.count(Some((&f.conditions, &f.logic)), c.field.as_deref(), start, end) as f64,
        ))),
        [Reduce(r)] => Some(store.reduce(None, r, start, end).map(PipelineResult::Number)),
        [Filter(f), Reduce(r)] => Some(
            store
                .reduce(Some((&f.conditions, &f.logic)), r, start, end)
                .map(PipelineResult::Number),
        ),
        [Find(f)] => Some(Ok(PipelineResult::Item(
            store
                .find_index(&f.conditions, &f.logic, start, end)
                .map(|i| rows[i].clone()),
        ))),
        [GroupBy(g)] if !g.aggregate.is_empty() => {
            Some(store.group_by_agg(g, None, start, end))
        }
        [Filter(f), GroupBy(g)] if !g.aggregate.is_empty() => Some(
            store.group_by_agg(g, Some((&f.conditions, &f.logic)), start, end),
        ),
        _ => None,
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn col_val_str(cols: &IndexMap<String, Col>, field: &str, i: usize) -> String {
    match cols.get(field) {
        Some(Col::F64(v)) => {
            let x = v[i];
            if x.is_nan() {
                "null".into()
            } else if x.fract() == 0.0 {
                format!("{}", x as i64)
            } else {
                x.to_string()
            }
        }
        Some(Col::Bool(v)) => match v[i] {
            1 => "true".into(),
            0 => "false".into(),
            _ => "null".into(),
        },
        Some(Col::Str(v)) => v[i].clone().unwrap_or_else(|| "null".into()),
        None => "null".into(),
    }
}
