//! Reading by place in a Sheet view (D41): the places `at` and `range` name
//! (`placeOf` in packages/core/src/expr.ts), and a Sheet view's grid, its
//! rows numbered by its grouping, then its manual order or its sort, ties in
//! file order (`arrangeGrid` in packages/core/src/grid.ts, with `sorter` in
//! arrange.ts). Filters play no part in a grid's order.

use std::cmp::Ordering;

use crate::eval::{js_string, ErrorCode, Value};
use crate::formula::Expr;
use crate::fxhash::FxHashMap as HashMap;

/// A corner's row: an offset from the formula's own row, a row id, or an open end (`nil`, `range` only).
#[derive(Clone, Debug, PartialEq)]
pub enum PlaceRow {
    Offset(i64),
    Id(String),
    Open,
}

#[derive(Clone, Debug)]
pub struct Place {
    pub view: String,
    pub table: Option<String>,
    pub from: (String, PlaceRow),
    pub to: (String, PlaceRow),
    /// An `at`: one cell, read as a value rather than a list.
    pub single: bool,
}

const AT_USAGE: &str = "at takes a field, a row and a Sheet view: (at \"balance\" -1 \"by-date\")";
const RANGE_USAGE: &str = "range takes two corners and a Sheet view: (range \"c\" nil \"c\" 0 \"by-date\")";

fn text(e: Option<&Expr>) -> Option<String> {
    match e {
        Some(Expr::Str(s)) if !s.is_empty() => Some(s.to_string()),
        _ => None,
    }
}

fn place_row(e: Option<&Expr>, open: bool) -> Option<PlaceRow> {
    match e {
        Some(Expr::Number(n)) if n.fract() == 0.0 && n.is_finite() => Some(PlaceRow::Offset(*n as i64)),
        Some(Expr::Str(s)) if !s.is_empty() => Some(PlaceRow::Id(s.to_string())),
        Some(Expr::Nil) if open => Some(PlaceRow::Open),
        _ => None,
    }
}

/// The place an `at` or `range` names, read from its arguments without evaluating them: they are
/// always written out (D41).
pub fn place_of(name: &str, args: &[Expr]) -> Result<Place, Value> {
    let table_ok = |t: Option<&Expr>| t.is_none() || text(t).is_some();
    if name == "at" {
        let (field, row, view) = (text(args.first()), place_row(args.get(1), false), text(args.get(2)));
        match (field, row, view) {
            (Some(field), Some(row), Some(view)) if (3..=4).contains(&args.len()) && table_ok(args.get(3)) => Ok(Place {
                view,
                table: text(args.get(3)),
                from: (field.clone(), row.clone()),
                to: (field, row),
                single: true,
            }),
            _ => Err(Value::Error(ErrorCode::Value, AT_USAGE.into())),
        }
    } else {
        let (from, from_row, to, to_row, view) = (text(args.first()), place_row(args.get(1), true), text(args.get(2)), place_row(args.get(3), true), text(args.get(4)));
        match (from, from_row, to, to_row, view) {
            (Some(from), Some(fr), Some(to), Some(tr), Some(view)) if (5..=6).contains(&args.len()) && table_ok(args.get(5)) => {
                Ok(Place { view, table: text(args.get(5)), from: (from, fr), to: (to, tr), single: false })
            }
            _ => Err(Value::Error(ErrorCode::Value, RANGE_USAGE.into())),
        }
    }
}

/// `row` and `rows` read where their argument is, never its value, so it must be written as an `at` or `range`.
pub fn place_arg(name: &str, args: &[Expr]) -> Result<Place, Value> {
    match args {
        [Expr::Call(f, inner)] if f == "at" || f == "range" => place_of(f, inner),
        _ => Err(Value::Error(ErrorCode::Value, format!("{name} takes an at or a range: ({name} (at \"c\" 0 \"by-date\"))"))),
    }
}

/// Which of its own table's Sheet views a formula reads by place, if any, and whether only rows below
/// (so it's worked out bottom up).
pub fn place_use(expr: &Expr, table: &str) -> Option<(String, bool)> {
    fn walk(e: &Expr, table: &str, view: &mut Option<String>, back: &mut bool, forward: &mut bool) {
        let Expr::Call(name, args) = e else { return };
        if name == "at" || name == "range" {
            if let Ok(p) = place_of(name, args) {
                if p.table.as_deref().is_none_or(|t| t == table) {
                    view.get_or_insert(p.view.clone());
                    for r in [&p.from.1, &p.to.1] {
                        if let PlaceRow::Offset(n) = r {
                            *back |= *n < 0;
                            *forward |= *n > 0;
                        }
                    }
                }
            }
        }
        for a in args {
            walk(a, table, view, back, forward);
        }
    }
    let (mut view, mut back, mut forward) = (None, false, false);
    walk(expr, table, &mut view, &mut back, &mut forward);
    view.map(|v| (v, forward && !back))
}

/// The tables a formula reads another table's Sheet view of.
pub fn place_tables<'a>(expr: &'a Expr, out: &mut Vec<&'a str>) {
    if let Expr::Call(name, args) = expr {
        let at = match name.as_str() {
            "at" => Some(3),
            "range" => Some(5),
            _ => None,
        };
        if let Some(Expr::Str(t)) = at.and_then(|k| args.get(k)) {
            out.push(t);
        }
        for a in args {
            place_tables(a, out);
        }
    }
}

// -- Grids -------------------------------------------------------------------

/// A Sheet view, as far as its grid goes.
#[derive(Clone, Debug, Default)]
pub struct SheetView {
    pub id: String,
    /// Its columns, lettered A, B, C… in this order (absent: the schema's).
    pub fields: Option<Vec<String>>,
    /// Its manual order, by row id.
    pub order: Vec<String>,
    /// Its sorts: field and whether descending.
    pub sort: Vec<(String, bool)>,
    pub group: Option<String>,
}

/// What a sort knows of a field: its enum's values in declared order, whether it's a datetime, whether `any`.
pub struct SortField<'a> {
    pub enum_values: &'a [String],
    pub datetime: bool,
    pub any: bool,
}

/// A value as a sort compares it (`SortKey` in arrange.ts); `None` when empty.
struct Key {
    /// Numbers, then text, then true/false; in an `any` field, then lists by their JSON (D56).
    kind: u8,
    is_string: bool,
    num: f64,
    text: String,
    folded: String,
    enum_at: i64,
    instant: f64,
}

fn key(v: &Value, f: &SortField) -> Option<Key> {
    if v.is_empty() {
        return None;
    }
    let kind = match v {
        Value::Number(_) => 0,
        Value::Bool(_) => 2,
        Value::List(_) if f.any => 3,
        _ => 1,
    };
    let text = match kind {
        1 => js_string(v),
        3 => {
            let mut s = String::new();
            crate::column::json_value(&mut s, v);
            s
        }
        _ => String::new(),
    };
    let is_string = matches!(v, Value::Str(_));
    let s = if let Value::Str(s) = v { Some(&s[..]) } else { None };
    Some(Key {
        kind,
        is_string,
        num: match v {
            Value::Number(n) => *n,
            Value::Bool(b) => f64::from(u8::from(*b)),
            _ => 0.0,
        },
        folded: if kind == 1 { text.to_lowercase() } else { String::new() },
        text,
        enum_at: s.filter(|_| !f.enum_values.is_empty()).map_or(-1, |s| f.enum_values.iter().position(|e| e == s).map_or(-1, |p| p as i64)),
        instant: s.filter(|_| f.datetime).map_or(f64::NAN, instant_of),
    })
}

fn compare(a: &Key, b: &Key, f: &SortField) -> Ordering {
    // An enum sorts by its declared order (not alphabetically).
    if !f.enum_values.is_empty() && a.is_string && b.is_string {
        match (a.enum_at, b.enum_at) {
            (-1, -1) => {}
            (x, -1) if x >= 0 => return Ordering::Less,
            (-1, _) => return Ordering::Greater,
            (x, y) => return x.cmp(&y),
        }
    }
    // By instant, not spelling: "10:00+02:00" is before "09:00Z".
    if !a.instant.is_nan() && !b.instant.is_nan() && a.instant != b.instant {
        return a.instant.partial_cmp(&b.instant).unwrap_or(Ordering::Equal);
    }
    if a.kind != b.kind {
        return a.kind.cmp(&b.kind);
    }
    match a.kind {
        3 => a.text.cmp(&b.text),
        1 => a.folded.cmp(&b.folded).then_with(|| a.text.cmp(&b.text)),
        // `a.num - b.num`: NaN compares as equal.
        _ => a.num.partial_cmp(&b.num).unwrap_or(Ordering::Equal),
    }
}

/// A Sheet view's grid order, as the file index of the row at each place, and its groups (start from 1,
/// count). `read` gives a row's value of a field; `id` its id.
pub fn arrange<'a>(
    count: usize,
    view: &SheetView,
    field: &dyn Fn(&str) -> SortField<'a>,
    read: &mut dyn FnMut(usize, &str) -> Value,
    id: &dyn Fn(usize) -> String,
) -> Vec<usize> {
    let all: Vec<usize> = (0..count).collect();
    let mut arranged = if view.order.is_empty() {
        all.clone()
    } else {
        // The rows its manual order names, in that order; the rest after, in file order.
        let at: HashMap<&str, usize> = view.order.iter().enumerate().map(|(k, id)| (id.as_str(), k)).collect();
        let (mut named, rest): (Vec<usize>, Vec<usize>) = all.iter().partition(|&&i| at.contains_key(id(i).as_str()));
        named.sort_by_key(|&i| at[id(i).as_str()]);
        named.extend(rest);
        named
    };
    if view.order.is_empty() && !view.sort.is_empty() {
        let fields: Vec<SortField> = view.sort.iter().map(|(f, _)| field(f)).collect();
        let mut keyed: Vec<(usize, Vec<Option<Key>>)> = all
            .iter()
            .map(|&i| (i, view.sort.iter().zip(&fields).map(|((name, _), f)| key(&read(i, name), f)).collect()))
            .collect();
        keyed.sort_by(|(_, a), (_, b)| {
            for (k, ((_, desc), f)) in view.sort.iter().zip(&fields).enumerate() {
                // Empties sort last, whichever way the sort runs.
                let c = match (&a[k], &b[k]) {
                    (None, None) => continue,
                    (None, _) => return Ordering::Greater,
                    (_, None) => return Ordering::Less,
                    (Some(x), Some(y)) => compare(x, y, f),
                };
                if c != Ordering::Equal {
                    return if *desc { c.reverse() } else { c };
                }
            }
            Ordering::Equal
        });
        arranged = keyed.into_iter().map(|(i, _)| i).collect();
    }
    let Some(group) = &view.group else { return arranged };
    // Enum values first, in their declared order; then the rest as they arrive; empties last.
    const EMPTY: &str = "(empty)";
    let mut keys: Vec<String> = Vec::new();
    let mut buckets: HashMap<String, Vec<usize>> = HashMap::default();
    for i in arranged {
        let k = group_key(&read(i, group));
        buckets
            .entry(k.clone())
            .or_insert_with(|| {
                keys.push(k);
                Vec::new()
            })
            .push(i);
    }
    let declared = field(group).enum_values.to_vec();
    let mut order = Vec::new();
    let ordered = declared.iter().filter(|k| buckets.contains_key(*k)).cloned().chain(keys.iter().filter(|k| *k != EMPTY && !declared.contains(k)).cloned()).chain(buckets.contains_key(EMPTY).then(|| EMPTY.to_string()));
    for k in ordered.collect::<Vec<_>>() {
        order.extend(buckets.remove(&k).unwrap_or_default());
    }
    order
}

/// A row's group: its value as text, `(empty)` for an empty one or an empty list.
fn group_key(v: &Value) -> String {
    if v.is_empty() || matches!(v, Value::List(items) if items.is_empty()) {
        "(empty)".to_string()
    } else {
        js_string(v)
    }
}

/// The instant a datetime names, in milliseconds, as JavaScript's `Date.parse` reads one; a floating
/// value (no offset) as if UTC. NaN when it isn't a datetime.
pub fn instant_of(s: &str) -> f64 {
    if !crate::holds::is_date_time(s) {
        return f64::NAN;
    }
    let b = s.as_bytes();
    let n = |r: std::ops::Range<usize>| s[r].parse::<i64>().unwrap_or(0);
    let (y, m, d) = (n(0..4), n(5..7), n(8..10));
    let (h, mi, sec) = (n(11..13), n(14..16), n(17..19));
    if sec > 59 {
        return f64::NAN;
    }
    let mut at = 19;
    let mut ms = 0i64;
    if b.get(at) == Some(&b'.') {
        at += 1;
        let start = at;
        while b.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1;
        }
        let digits = &s[start..at];
        ms = format!("{:0<3}", &digits[..digits.len().min(3)]).parse().unwrap_or(0);
    }
    let offset = match &b[at..] {
        [sign, ..] if *sign == b'+' || *sign == b'-' => {
            let o = n(at + 1..at + 3) * 60 + n(at + 4..at + 6);
            if *sign == b'+' { o } else { -o }
        }
        _ => 0,
    };
    // Days from 1970-01-01 to y-m-d (Howard Hinnant's days_from_civil).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    ((days * 86_400 + h * 3600 + mi * 60 + sec - offset * 60) * 1000 + ms) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instants_as_date_parse_gives_them() {
        assert_eq!(instant_of("1970-01-01T00:00:00Z"), 0.0);
        assert_eq!(instant_of("2026-10-24T12:00:00.5+02:00"), 1_792_836_000_500.0);
        assert_eq!(instant_of("2026-10-24T10:00:00"), 1_792_836_000_000.0);
        assert_eq!(instant_of("2026-10-24t10:00:00z"), 1_792_836_000_000.0);
        assert_eq!(instant_of("2026-10-24T12:00:00.123456Z"), 1_792_843_200_123.0);
        assert!(instant_of("2026-01-01T23:59:60Z").is_nan());
        assert!(instant_of("2026-10-24").is_nan());
    }
}
