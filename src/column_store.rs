use crate::types::{
    ArithOp, Condition, ConditionLogic, DataError, GroupByOp, MapExpr, Operation, Operator,
    PipelineResult, ReduceOp, Reducer, Row,
};
use indexmap::IndexMap;
use serde_json::Value;

// ── BitSet utility for fast filtering ────────────────────────────────────────

pub(crate) struct BitSet {
    bits: Vec<u64>,
    len: usize,
}

impl BitSet {
    pub fn new(len: usize, all_set: bool) -> Self {
        let size = (len + 63) / 64;
        let fill = if all_set { u64::MAX } else { 0 };
        let mut bits = vec![fill; size];
        if all_set && len % 64 != 0 {
            bits[size - 1] &= (1 << (len % 64)) - 1;
        }
        Self { bits, len }
    }

    #[inline]
    pub fn set(&mut self, i: usize) {
        self.bits[i / 64] |= 1 << (i % 64);
    }

    #[inline]
    pub fn get(&self, i: usize) -> bool {
        (self.bits[i / 64] >> (i % 64)) & 1 != 0
    }

    pub fn and(&mut self, other: &Self) {
        for (a, b) in self.bits.iter_mut().zip(other.bits.iter()) {
            *a &= *b;
        }
    }

    pub fn or(&mut self, other: &Self) {
        for (a, b) in self.bits.iter_mut().zip(other.bits.iter()) {
            *a |= *b;
        }
    }

    pub fn count(&self) -> usize {
        self.bits.iter().map(|b| b.count_ones() as usize).sum()
    }

    pub fn indices(&self) -> Vec<u32> {
        let mut idx = Vec::with_capacity(self.count());
        for (i, &block) in self.bits.iter().enumerate() {
            if block == 0 {
                continue;
            }
            for j in 0..64 {
                if (block >> j) & 1 != 0 {
                    let k = i * 64 + j;
                    if k < self.len {
                        idx.push(k as u32);
                    }
                }
            }
        }
        idx
    }
}

// ── Column representation ─────────────────────────────────────────────────────

pub(crate) struct StrColumn {
    pub codes: Vec<u16>,                 // per-row: index into categories[]
    pub categories: Vec<Option<String>>, // unique values in insertion order
}

pub(crate) enum Col {
    F64(Vec<f64>),  // f64::NAN = null / missing
    Bool(Vec<u8>),  // 0 = false · 1 = true · 255 = null
    Str(StrColumn), // categorical: codes[i] indexes into categories[]
}

// ── Per-aggregate lean accumulator (only allocates what the reducer needs) ────

enum AggBuf {
    SumAvg { sums: Vec<f64>, cnts: Vec<usize> },
    Min { vals: Vec<f64>, cnts: Vec<usize> },
    Max { vals: Vec<f64>, cnts: Vec<usize> },
    First { vals: Vec<f64>, found: Vec<bool> },
    Last { vals: Vec<f64> },
}

impl AggBuf {
    fn new(reducer: &Reducer, n: usize) -> Self {
        match reducer {
            Reducer::Sum | Reducer::Avg => AggBuf::SumAvg {
                sums: vec![0.0; n],
                cnts: vec![0; n],
            },
            Reducer::Min => AggBuf::Min {
                vals: vec![f64::INFINITY; n],
                cnts: vec![0; n],
            },
            Reducer::Max => AggBuf::Max {
                vals: vec![f64::NEG_INFINITY; n],
                cnts: vec![0; n],
            },
            Reducer::First => AggBuf::First {
                vals: vec![0.0; n],
                found: vec![false; n],
            },
            Reducer::Last => AggBuf::Last { vals: vec![0.0; n] },
        }
    }

    #[inline(always)]
    fn update(&mut self, g: usize, v: f64) {
        match self {
            AggBuf::SumAvg { sums, cnts } => {
                sums[g] += v;
                cnts[g] += 1;
            }
            AggBuf::Min { vals, cnts } => {
                if v < vals[g] {
                    vals[g] = v;
                }
                cnts[g] += 1;
            }
            AggBuf::Max { vals, cnts } => {
                if v > vals[g] {
                    vals[g] = v;
                }
                cnts[g] += 1;
            }
            AggBuf::First { vals, found } => {
                if !found[g] {
                    vals[g] = v;
                    found[g] = true;
                }
            }
            AggBuf::Last { vals } => {
                vals[g] = v;
            }
        }
    }

    fn result(&self, g: usize, reducer: &Reducer) -> f64 {
        match (self, reducer) {
            (AggBuf::SumAvg { sums, .. }, Reducer::Sum) => sums[g],
            (AggBuf::SumAvg { sums, cnts }, Reducer::Avg) => {
                let n = cnts[g];
                if n > 0 { sums[g] / n as f64 } else { 0.0 }
            }
            (AggBuf::Min { vals, cnts }, Reducer::Min) => {
                if cnts[g] > 0 {
                    vals[g]
                } else {
                    0.0
                }
            }
            (AggBuf::Max { vals, cnts }, Reducer::Max) => {
                if cnts[g] > 0 {
                    vals[g]
                } else {
                    0.0
                }
            }
            (AggBuf::First { vals, found }, Reducer::First) => {
                if found[g] {
                    vals[g]
                } else {
                    0.0
                }
            }
            (AggBuf::Last { vals }, Reducer::Last) => vals[g],
            _ => 0.0,
        }
    }
}

// ── Store ─────────────────────────────────────────────────────────────────────

pub(crate) struct ColumnStore {
    pub(crate) cols: IndexMap<String, Col>,
    pub len: usize,
}

impl ColumnStore {
    pub fn from_rows(rows: &[Row]) -> Self {
        let len = rows.len();
        if len == 0 {
            return Self {
                cols: IndexMap::new(),
                len: 0,
            };
        }
        let cols = rows[0]
            .keys()
            .map(|name| (name.clone(), build_col(rows, name)))
            .collect();
        Self { cols, len }
    }

    fn get_bitset(
        &self,
        filter: Option<(&[Condition], &ConditionLogic)>,
        start: usize,
        end: usize,
    ) -> Option<BitSet> {
        filter.map(|(conds, logic)| {
            let resolved = resolve(&self.cols, conds);
            match logic {
                ConditionLogic::And => {
                    let mut res = BitSet::new(self.len, true);
                    for rc in resolved {
                        res.and(&rc.eval_to_bitset(self.len, start, end));
                    }
                    res
                }
                ConditionLogic::Or => {
                    let mut res = BitSet::new(self.len, false);
                    for rc in resolved {
                        res.or(&rc.eval_to_bitset(self.len, start, end));
                    }
                    res
                }
            }
        })
    }

    // ── count ─────────────────────────────────────────────────────────────────

    // ── reduce ────────────────────────────────────────────────────────────────

    // ── find ─────────────────────────────────────────────────────────────────

    // ── filter → indices ──────────────────────────────────────────────────────

    pub fn filter_indices(
        &self,
        conds: &[Condition],
        logic: &ConditionLogic,
        start: usize,
        end: usize,
    ) -> Vec<u32> {
        let mask = match logic {
            ConditionLogic::And => {
                let mut m = BitSet::new(self.len, true);
                let res = resolve(&self.cols, conds);
                for rc in res {
                    m.and(&rc.eval_to_bitset(self.len, start, end));
                }
                m
            }
            ConditionLogic::Or => {
                let mut m = BitSet::new(self.len, false);
                let res = resolve(&self.cols, conds);
                for rc in res {
                    m.or(&rc.eval_to_bitset(self.len, start, end));
                }
                m
            }
        };
        mask.indices()
    }

    // ── groupBy → index buckets per group (no row serialization) ─────────────

    pub fn group_by_indices_raw(
        &self,
        field: &str,
        filter: Option<(&[Condition], &ConditionLogic)>,
        start: usize,
        end: usize,
    ) -> Vec<(String, Vec<u32>)> {
        let Some(Col::Str(key_col)) = self.cols.get(field) else {
            return vec![];
        };
        let n_cats = key_col.categories.len();
        let codes = key_col.codes.as_slice();
        let mut buckets: Vec<Vec<u32>> = vec![vec![]; n_cats];

        let mask = self.get_bitset(filter, start, end);

        if let Some(m) = &mask {
            for i in start..end {
                if m.get(i) {
                    buckets[codes[i] as usize].push(i as u32);
                }
            }
        } else {
            for i in start..end {
                buckets[codes[i] as usize].push(i as u32);
            }
        }

        key_col
            .categories
            .iter()
            .zip(buckets)
            .filter(|(_, v)| !v.is_empty())
            .map(|(cat, v)| (cat.clone().unwrap_or_else(|| "null".into()), v))
            .collect()
    }

    // ── compute a single field via MapExpr (returns Float64 column) ───────────

    pub fn compute_field(&self, expr: &MapExpr, start: usize, end: usize) -> Vec<f64> {
        (start..end)
            .map(|i| eval_map_expr(&self.cols, expr, i))
            .collect()
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
                        if v.is_nan() {
                            None
                        } else {
                            Some(v)
                        }
                    })
                    .unwrap_or(0.0));
            }
            Reducer::Last => {
                return Ok(indices
                    .iter()
                    .rev()
                    .find_map(|&i| {
                        let v = col[i];
                        if v.is_nan() {
                            None
                        } else {
                            Some(v)
                        }
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
                if v < min {
                    min = v;
                }
                if v > max {
                    max = v;
                }
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
                if seen_bool {
                    seen_other = true;
                    break;
                }
                seen_num = true;
            }
            Some(Value::Bool(_)) => {
                if seen_num {
                    seen_other = true;
                    break;
                }
                seen_bool = true;
            }
            Some(Value::Null) | None => {}
            _ => {
                seen_other = true;
                break;
            }
        }
    }

    if seen_other {
        // Phase 1: collect unique values (insertion order = code assignment)
        let mut cat_map: IndexMap<Option<String>, u16> = IndexMap::new();
        for row in rows {
            let s = row_str_val(row, field);
            let next = cat_map.len() as u16;
            cat_map.entry(s).or_insert(next);
        }
        // Phase 2: encode each row as a u16 code
        let codes: Vec<u16> = rows
            .iter()
            .map(|row| *cat_map.get(&row_str_val(row, field)).unwrap())
            .collect();
        let categories: Vec<Option<String>> = cat_map.into_keys().collect();
        Col::Str(StrColumn { codes, categories })
    } else if seen_bool {
        Col::Bool(
            rows.iter()
                .map(|r| match r.get(field) {
                    Some(Value::Bool(true)) => 1u8,
                    Some(Value::Bool(false)) => 0u8,
                    _ => 255u8,
                })
                .collect(),
        )
    } else {
        Col::F64(
            rows.iter()
                .map(|r| match r.get(field) {
                    Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                    _ => f64::NAN,
                })
                .collect(),
        )
    }
}

#[inline]
fn row_str_val(row: &Row, field: &str) -> Option<String> {
    match row.get(field) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(v) if !v.is_null() => Some(v.to_string()),
        _ => None,
    }
}

// ── Condition resolution (eliminate hash lookups from the scan loop) ──────────

enum ResolvedCond<'a> {
    F64 {
        col: &'a [f64],
        op: &'a Operator,
        threshold: f64,
        raw: &'a Value,
    },
    Bool {
        col: &'a [u8],
        op: &'a Operator,
        threshold: u8,
    },
    StrCode {
        codes: &'a [u16],
        eq: bool,
        target: Option<u16>,
    }, // Eq / Ne: integer compare
    Str {
        codes: &'a [u16],
        cats: &'a [Option<String>],
        op: &'a Operator,
        raw: &'a Value,
    },
    Missing,
}

impl<'a> ResolvedCond<'a> {
    fn eval_to_bitset(&self, len: usize, start: usize, end: usize) -> BitSet {
        let mut bs = BitSet::new(len, false);
        match self {
            ResolvedCond::F64 {
                col, op, threshold, ..
            } => {
                let th = *threshold;
                for i in start..end {
                    let v = col[i];
                    let passes = match op {
                        Operator::Gt => v > th,
                        Operator::Gte => v >= th,
                        Operator::Lt => v < th,
                        Operator::Lte => v <= th,
                        Operator::Eq => v == th,
                        Operator::Ne => v != th && !v.is_nan(),
                        Operator::IsNull => v.is_nan(),
                        Operator::IsNotNull => !v.is_nan(),
                        _ => eval_one(self, i),
                    };
                    if passes {
                        bs.set(i);
                    }
                }
            }
            ResolvedCond::Bool { col, op, threshold } => {
                let th = *threshold;
                for i in start..end {
                    let v = col[i];
                    let passes = match op {
                        Operator::Eq => v == th,
                        Operator::Ne => v != th && v != 255,
                        Operator::IsNull => v == 255,
                        Operator::IsNotNull => v != 255,
                        _ => eval_one(self, i),
                    };
                    if passes {
                        bs.set(i);
                    }
                }
            }
            ResolvedCond::StrCode { codes, eq, target } => {
                if let Some(tc) = target {
                    let tc = *tc;
                    if *eq {
                        for i in start..end {
                            if codes[i] == tc {
                                bs.set(i);
                            }
                        }
                    } else {
                        for i in start..end {
                            if codes[i] != tc {
                                bs.set(i);
                            }
                        }
                    }
                } else if !*eq {
                    for i in start..end {
                        bs.set(i);
                    }
                }
            }
            _ => {
                for i in start..end {
                    if eval_one(self, i) {
                        bs.set(i);
                    }
                }
            }
        }
        bs
    }
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
            Some(Col::Str(sc)) => match &c.operator {
                Operator::Eq | Operator::Ne => {
                    let target = sc
                        .categories
                        .iter()
                        .position(|cat| cat.as_deref() == c.value.as_str())
                        .map(|p| p as u16);
                    let eq = matches!(c.operator, Operator::Eq);
                    ResolvedCond::StrCode {
                        codes: &sc.codes,
                        eq,
                        target,
                    }
                }
                _ => ResolvedCond::Str {
                    codes: &sc.codes,
                    cats: &sc.categories,
                    op: &c.operator,
                    raw: &c.value,
                },
            },
            None => ResolvedCond::Missing,
        })
        .collect()
}

#[inline]
fn eval_one(rc: &ResolvedCond, i: usize) -> bool {
    match rc {
        ResolvedCond::F64 {
            col,
            op,
            threshold,
            raw,
        } => {
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
                Operator::In => raw.as_array().map_or(false, |arr| {
                    arr.iter().any(|x| x.as_f64().map_or(false, |x| x == v))
                }),
                Operator::NotIn => raw.as_array().map_or(true, |arr| {
                    !arr.iter().any(|x| x.as_f64().map_or(false, |x| x == v))
                }),
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
        ResolvedCond::StrCode { codes, eq, target } => {
            let v = codes[i];
            match target {
                Some(tc) => {
                    if *eq {
                        v == *tc
                    } else {
                        v != *tc
                    }
                }
                None => !*eq,
            }
        }
        ResolvedCond::Str {
            codes,
            cats,
            op,
            raw,
        } => match &cats[codes[i] as usize] {
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
        Operator::In => raw.as_array().map_or(false, |arr| {
            arr.iter().any(|x| x.as_str().map_or(false, |r| r == s))
        }),
        Operator::NotIn => raw.as_array().map_or(true, |arr| {
            !arr.iter().any(|x| x.as_str().map_or(false, |r| r == s))
        }),
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

    // Collect all consecutive intermediate filters at the start
    let mut filter_ops = Vec::new();
    let mut last_idx = 0;
    for (i, op) in ops.iter().enumerate() {
        if let Filter(f) = op {
            filter_ops.push((f.conditions.as_slice(), &f.logic));
            last_idx = i + 1;
        } else {
            break;
        }
    }

    // Determine the terminal operation after the filters
    let terminal_op = ops.get(last_idx);

    // If there's more after the terminal op, or it's a map (intermediate), we can't columnarize yet.
    if last_idx < ops.len() && last_idx + 1 < ops.len() {
        return None;
    }

    // Compute a merged bitmask for all initial filters
    let merged_mask = if filter_ops.is_empty() {
        None
    } else {
        let mut mask = BitSet::new(store.len, true);
        for (conds, logic) in filter_ops {
            let res = resolve(&store.cols, conds);
            match logic {
                ConditionLogic::And => {
                    for rc in res {
                        mask.and(&rc.eval_to_bitset(store.len, start, end));
                    }
                }
                ConditionLogic::Or => {
                    let mut or_mask = BitSet::new(store.len, false);
                    for rc in res {
                        or_mask.or(&rc.eval_to_bitset(store.len, start, end));
                    }
                    mask.and(&or_mask);
                }
            }
        }
        Some(mask)
    };

    let _passes = |i: usize| -> bool { merged_mask.as_ref().map_or(true, |m: &BitSet| m.get(i)) };

    match terminal_op {
        Some(Count(c)) => Some(Ok(PipelineResult::Number(store.count_with_mask(
            merged_mask.as_ref(),
            c.field.as_deref(),
            start,
            end,
        ) as f64))),
        Some(Reduce(r)) => Some(
            store
                .reduce_with_mask(merged_mask.as_ref(), r, start, end)
                .map(PipelineResult::Number),
        ),
        Some(Find(f)) => {
            let combined_mask = if f.conditions.is_empty() {
                merged_mask
            } else {
                let mut m = merged_mask.unwrap_or_else(|| BitSet::new(store.len, true));
                let res = resolve(&store.cols, &f.conditions);
                match f.logic {
                    ConditionLogic::And => {
                        for rc in res {
                            m.and(&rc.eval_to_bitset(store.len, start, end));
                        }
                    }
                    ConditionLogic::Or => {
                        let mut or_mask = BitSet::new(store.len, false);
                        for rc in res {
                            or_mask.or(&rc.eval_to_bitset(store.len, start, end));
                        }
                        m.and(&or_mask);
                    }
                }
                Some(m)
            };
            Some(Ok(PipelineResult::Item(
                combined_mask
                    .and_then(|m| (start..end).find(|&i| m.get(i)))
                    .map(|i| rows[i].clone()),
            )))
        }
        Some(GroupBy(g)) if !g.aggregate.is_empty() => {
            Some(store.group_by_agg_with_mask(g, merged_mask.as_ref(), start, end))
        }
        None if !ops.is_empty() && last_idx == ops.len() => {
            // All operations were filters, return indices materialized as rows
            Some(Ok(PipelineResult::Array(
                merged_mask
                    .map(|m| m.indices())
                    .unwrap_or_else(|| (start..end).map(|i| i as u32).collect())
                    .into_iter()
                    .map(|i| rows[i as usize].clone())
                    .collect(),
            )))
        }
        _ => None,
    }
}

impl ColumnStore {
    fn count_with_mask(
        &self,
        mask: Option<&BitSet>,
        truthy_field: Option<&str>,
        start: usize,
        end: usize,
    ) -> usize {
        if let Some(f) = truthy_field {
            match self.cols.get(f) {
                Some(Col::Bool(v)) => {
                    let mut c = 0;
                    for i in start..end {
                        if mask.map_or(true, |m| m.get(i)) && v[i] == 1 {
                            c += 1;
                        }
                    }
                    c
                }
                Some(Col::F64(v)) => {
                    let mut c = 0;
                    for i in start..end {
                        if mask.map_or(true, |m| m.get(i)) && !v[i].is_nan() {
                            c += 1;
                        }
                    }
                    c
                }
                Some(Col::Str(sc)) => {
                    let mut c = 0;
                    for i in start..end {
                        if mask.map_or(true, |m| m.get(i))
                            && sc.categories[sc.codes[i] as usize].is_some()
                        {
                            c += 1;
                        }
                    }
                    c
                }
                None => 0,
            }
        } else {
            mask.map_or(end - start, |m| m.count())
        }
    }

    fn reduce_with_mask(
        &self,
        mask: Option<&BitSet>,
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

        let passes = |i: usize| -> bool { mask.map_or(true, |m| m.get(i)) };

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
                    if v < min {
                        min = v;
                    }
                    if v > max {
                        max = v;
                    }
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

    fn group_by_agg_with_mask(
        &self,
        op: &GroupByOp,
        mask: Option<&BitSet>,
        start: usize,
        end: usize,
    ) -> Result<PipelineResult, DataError> {
        // ── fast path: single Str key → integer bucketing, lean accumulators ─
        if op.field.len() == 1 {
            if let Some(Col::Str(key_col)) = self.cols.get(&op.field[0]) {
                let n_cats = key_col.categories.len();
                let codes = key_col.codes.as_slice();
                let mut counts = vec![0usize; n_cats];

                let agg_cols: Vec<&[f64]> = op
                    .aggregate
                    .iter()
                    .map(|a| match self.cols.get(&a.field) {
                        Some(Col::F64(v)) => v.as_slice(),
                        _ => &[],
                    })
                    .collect();

                // Only allocate what each reducer actually needs
                let mut agg_bufs: Vec<AggBuf> = op
                    .aggregate
                    .iter()
                    .map(|a| AggBuf::new(&a.reducer, n_cats))
                    .collect();

                // Two separate loops — no closure/match overhead in the no-filter path
                if let Some(m) = &mask {
                    for i in start..end {
                        if !m.get(i) {
                            continue;
                        }
                        let g = codes[i] as usize;
                        counts[g] += 1;
                        for (buf, col) in agg_bufs.iter_mut().zip(agg_cols.iter()) {
                            if col.is_empty() {
                                continue;
                            }
                            let v = col[i];
                            if !v.is_nan() {
                                buf.update(g, v);
                            }
                        }
                    }
                } else {
                    for i in start..end {
                        let g = codes[i] as usize;
                        counts[g] += 1;
                        for (buf, col) in agg_bufs.iter_mut().zip(agg_cols.iter()) {
                            if col.is_empty() {
                                continue;
                            }
                            let v = col[i];
                            if !v.is_nan() {
                                buf.update(g, v);
                            }
                        }
                    }
                }

                // Output: N_unique iterations only
                let mut out: IndexMap<String, Value> = IndexMap::new();
                for (g, cat) in key_col.categories.iter().enumerate() {
                    if counts[g] == 0 {
                        continue;
                    }
                    let key = cat.clone().unwrap_or_else(|| "null".into());
                    let mut agg: serde_json::Map<String, Value> = serde_json::Map::new();
                    agg.insert("_count".into(), Value::Number(counts[g].into()));
                    for (buf, reduce_op) in agg_bufs.iter().zip(op.aggregate.iter()) {
                        let alias = reduce_op.alias.clone().unwrap_or_else(|| {
                            format!(
                                "{}_{}",
                                format!("{:?}", reduce_op.reducer).to_lowercase(),
                                reduce_op.field
                            )
                        });
                        let val = buf.result(g, &reduce_op.reducer);
                        let num = serde_json::Number::from_f64(val).unwrap_or_else(|| 0.into());
                        agg.insert(alias, Value::Number(num));
                    }
                    out.insert(key, Value::Object(agg));
                }
                return Ok(PipelineResult::Object(out));
            }
        }

        // ── general fallback (multi-field or non-Str key) ─────────────────────
        let passes = |i: usize| -> bool { mask.map_or(true, |m| m.get(i)) };
        let mut groups: IndexMap<String, Vec<usize>> = IndexMap::new();
        for i in start..end {
            if !passes(i) {
                continue;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn eval_map_expr(cols: &IndexMap<String, Col>, expr: &MapExpr, i: usize) -> f64 {
    match expr {
        MapExpr::Literal { value } => value.as_f64().unwrap_or(f64::NAN),
        MapExpr::Field { name } => match cols.get(name) {
            Some(Col::F64(v)) => v[i],
            _ => f64::NAN,
        },
        MapExpr::Arithmetic { op, left, right } => {
            let l = eval_map_expr(cols, left, i);
            let r = eval_map_expr(cols, right, i);
            match op {
                ArithOp::Add => l + r,
                ArithOp::Sub => l - r,
                ArithOp::Mul => l * r,
                ArithOp::Div => l / r,
            }
        }
        MapExpr::Template { .. } => f64::NAN,
    }
}

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
        Some(Col::Str(sc)) => sc.categories[sc.codes[i] as usize]
            .clone()
            .unwrap_or_else(|| "null".into()),
        None => "null".into(),
    }
}
