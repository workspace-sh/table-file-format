//! A view of a held table (table-file-format#867, step 2): its rows filtered,
//! hidden, searched, ordered or sorted, grouped, and totalled, as
//! table-core's `applyView`, `searchRows` and `memoryViewRows` give them.
//!
//! Like the SQLite index (`queryIndex`), a held table answers only what it
//! can promise is what memory gives, and otherwise says it can't (`None`),
//! for the caller to work the view out in memory. It can't promise:
//!
//! - an ordered comparison (`gt`, `gte`, `lt`, `lte`) where JavaScript would
//!   coerce: a value of another type than the field's, or a field whose cells
//!   don't all hold its type, or an `any` field;
//! - a sort or group on a field whose cells don't all hold its type, on an
//!   array or `any` field, or on a key the schema doesn't name;
//! - a sort in a viewer's own language (that's `Intl`'s);
//! - computed fields and cells' own formulas (their values aren't held: the
//!   caller doesn't ask).
//!
//! Everything else is answered exactly: equality, containment, prefixes and
//! suffixes, lists and emptiness are strict in JavaScript, so they're the
//! same over any value; totals read every value as `viewTotal` does.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use serde_json::Value as J;

use crate::encoding::instant_of;
use crate::rows::{kind, Cell, Rows};

/// What a field's cells hold, as the index plans its columns.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Number,
    Boolean,
    Text,
    Datetime,
    Array,
    Opaque,
}

fn kind_of(ty: &str) -> Kind {
    match ty {
        "number" | "integer" | "year" => Kind::Number,
        "boolean" => Kind::Boolean,
        "string" | "date" | "time" | "duration" => Kind::Text,
        "datetime" => Kind::Datetime,
        "array" => Kind::Array,
        _ => Kind::Opaque,
    }
}

/// A schema field as a view reads it.
#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub ty: String,
    /// Its declared choices, in order (`enumValues`).
    pub choices: Vec<String>,
}

/// What a view asks (table-core's `IndexQuery`).
#[derive(Debug, Default)]
pub struct Query {
    pub filter: Vec<J>,
    pub hidden: Vec<String>,
    pub search: Option<String>,
    pub order: Vec<String>,
    pub sort: Vec<(String, bool)>,
    pub group: Option<String>,
    pub totals: Vec<(String, String)>,
    pub bodies: HashMap<String, String>,
}

/// A view worked out: the rows it shows, in order, and what it says of them.
#[derive(Debug, Default)]
pub struct Shown {
    /// The rows in the view's order; None when it shows every row in file order (there's nothing to list).
    pub places: Option<Vec<u32>>,
    /// How many rows it shows.
    pub count: usize,
    pub in_view: usize,
    pub groups: Vec<(String, usize, usize)>,
    /// By field, in the order asked; None where `viewTotal` gives undefined.
    pub totals: Vec<(String, Option<f64>)>,
    place_of: std::sync::OnceLock<HashMap<u32, u32>>,
}

impl Shown {
    /// A row's place in the view, or None.
    pub fn place(&self, row: u32) -> Option<u32> {
        match &self.places {
            None => ((row as usize) < self.count).then_some(row),
            Some(places) => self.place_of.get_or_init(|| places.iter().enumerate().rev().map(|(p, r)| (*r, p as u32)).collect()).get(&row).copied(),
        }
    }

    /// The rows at places `from` up to `to`, in order.
    pub fn rows(&self, from: usize, to: usize) -> Vec<usize> {
        let to = to.min(self.count);
        let from = from.min(to);
        match &self.places {
            None => (from..to).collect(),
            Some(places) => places[from..to].iter().map(|r| *r as usize).collect(),
        }
    }
}

/// A cell as JavaScript holds it after `JSON.parse`.
#[derive(Debug, Clone, PartialEq)]
enum Js<'a> {
    Undefined,
    Null,
    Num(f64),
    Bool(bool),
    Str(Cow<'a, str>),
    /// An array or object: never strictly equal to anything.
    Json(&'a [u8]),
}

fn js<'a>(r: &'a Rows, row: usize, c: Cell) -> Js<'a> {
    match c.kind {
        kind::ABSENT => Js::Undefined,
        kind::NULL => Js::Null,
        kind::TRUE => Js::Bool(true),
        kind::FALSE => Js::Bool(false),
        kind::NUMBER => Js::Num(std::str::from_utf8(r.raw(row, c)).ok().and_then(|n| n.parse().ok()).unwrap_or(f64::NAN)),
        kind::TEXT => Js::Str(String::from_utf8_lossy(r.raw(row, c))),
        kind::ESCAPED => Js::Str(Cow::Owned(r.text(row, c).unwrap_or_default())),
        _ => Js::Json(r.raw(row, c)),
    }
}

/// A filter's value as JavaScript holds it.
fn value_js(v: Option<&J>) -> Js<'static> {
    match v {
        None => Js::Undefined,
        Some(J::Null) => Js::Null,
        Some(J::Bool(b)) => Js::Bool(*b),
        Some(J::Number(n)) => Js::Num(n.as_f64().unwrap_or(f64::NAN)),
        Some(J::String(s)) => Js::Str(Cow::Owned(s.clone())),
        Some(_) => Js::Json(b"[]"),
    }
}

/// `===`: no coercion; arrays and objects are never equal (they're compared by reference).
fn strictly_equal(a: &Js, b: &Js) -> bool {
    match (a, b) {
        (Js::Undefined, Js::Undefined) | (Js::Null, Js::Null) => true,
        (Js::Num(x), Js::Num(y)) => x == y,
        (Js::Bool(x), Js::Bool(y)) => x == y,
        (Js::Str(x), Js::Str(y)) => x == y,
        _ => false,
    }
}

/// SameValueZero, as `includes` compares: `===`, and NaN equal to itself.
fn same_value_zero(a: &Js, b: &Js) -> bool {
    match (a, b) {
        (Js::Num(x), Js::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        _ => strictly_equal(a, b),
    }
}

/// A JSON array's items as JavaScript holds them; None when it isn't an array.
fn items(raw: &[u8]) -> Option<Vec<Js<'static>>> {
    match serde_json::from_slice::<J>(raw).ok()? {
        J::Array(xs) => Some(xs.iter().map(|x| value_js(Some(x))).collect()),
        _ => None,
    }
}

/// `String(v)` for what a filter's value can be; None for an array or object (not promised).
fn to_string(v: &Js) -> Option<String> {
    Some(match v {
        Js::Undefined => "undefined".into(),
        Js::Null => "null".into(),
        Js::Bool(b) => b.to_string(),
        Js::Num(n) => number_text(*n),
        Js::Str(s) => s.to_string(),
        Js::Json(_) => return None,
    })
}

/// A number as JavaScript writes it (`String(n)`).
pub fn number_text(n: f64) -> String {
    if n == 0.0 {
        return "0".into();
    }
    ryu_js::Buffer::new().format(n).to_string()
}

/// Two strings as JavaScript's `<` compares them: by UTF-16 code unit.
fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn is_empty(v: &Js) -> bool {
    matches!(v, Js::Undefined | Js::Null) || matches!(v, Js::Str(s) if s.is_empty())
}

/// Whether a cell is what its field's kind holds (the index's `conforms`). Empty is always fine.
fn conforms(k: Kind, v: &Js) -> bool {
    if is_empty(v) {
        return true;
    }
    match k {
        Kind::Number => matches!(v, Js::Num(n) if n.is_finite()),
        Kind::Boolean => matches!(v, Js::Bool(_)),
        Kind::Text => matches!(v, Js::Str(_)),
        Kind::Datetime => matches!(v, Js::Str(s) if !instant_of(s).is_nan()),
        Kind::Array => match v {
            Js::Json(raw) => items(raw).is_some_and(|xs| xs.iter().all(|x| matches!(x, Js::Str(_)) || matches!(x, Js::Num(n) if n.is_finite()))),
            _ => false,
        },
        Kind::Opaque => true,
    }
}

/// JavaScript's `trim()`: ECMAScript white space and line ends at either end.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c| matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
}

/// A compiled filter: what it asks of one cell.
enum Test {
    /// Matches nothing: an ordered comparison on a key no row holds (every cell empty).
    Never,
    Eq(Js<'static>, bool),
    Ordered { op: Ordering, or_equal: bool, value: Js<'static>, instant: f64, datetime: bool },
    Contains(Js<'static>, Option<String>, bool),
    Affix(String, bool),
    Empty(bool),
    In(Option<Vec<Js<'static>>>, bool),
}

struct Filter {
    field: Option<usize>,
    name: String,
    test: Test,
}

/// The fields whose cells don't all hold their kind: worked out once a table, for the kinds asked.
pub struct Conformance(HashMap<(String, Kind), bool>);

impl Conformance {
    pub fn new() -> Self {
        Conformance(HashMap::new())
    }
    fn ok(&mut self, r: &Rows, field: Option<usize>, name: &str, k: Kind) -> bool {
        *self.0.entry((name.to_string(), k)).or_insert_with(|| (0..r.len()).all(|row| conforms(k, &js(r, row, r.cell_named(row, field, name)))))
    }
}

impl Default for Conformance {
    fn default() -> Self {
        Self::new()
    }
}

/// A view of `r`, or None when it can't promise what memory gives.
pub fn view(r: &Rows, fields: &[Field], q: &Query, conformance: &mut Conformance) -> Option<Shown> {
    let schema: HashMap<&str, &Field> = fields.iter().map(|f| (f.name.as_str(), f)).collect();
    let kind_named = |name: &str| schema.get(name).map(|f| (kind_of(&f.ty), f.ty == "datetime", f.ty == "any"));

    // Nothing to filter, search, order or group: every row, as read.
    let needle = q.search.as_deref().map(|s| js_trim(s).to_lowercase()).filter(|n| !n.is_empty());
    if q.filter.is_empty() && q.hidden.is_empty() && needle.is_none() && q.order.is_empty() && q.sort.is_empty() && q.group.is_none() {
        let all: Vec<u32> = Vec::new();
        let totals = totals_of(r, &q.totals, None, &all);
        return Some(Shown { places: None, count: r.len(), in_view: r.len(), groups: Vec::new(), totals, place_of: std::sync::OnceLock::new() });
    }

    // Filters, compiled once; any that can't be promised and the view isn't.
    let mut filters = Vec::new();
    for f in &q.filter {
        let name = f.get("field")?.as_str()?.to_string();
        let operator = f.get("operator")?.as_str()?;
        let value = value_js(f.get("value"));
        let field = r.field(&name);
        let test = match operator {
            "eq" | "neq" => Test::Eq(value, operator == "eq"),
            "gt" | "gte" | "lt" | "lte" if kind_named(&name).is_none() && field.is_none() && name != "id" && !r.has_extra(&name) => Test::Never,
            "gt" | "gte" | "lt" | "lte" => {
                // Ordered: only one type of value on both sides, or JavaScript would coerce.
                let (k, datetime, any) = kind_named(&name)?;
                if any {
                    return None;
                }
                let fits = matches!((k, &value), (Kind::Number, Js::Num(n)) if n.is_finite())
                    || matches!((k, &value), (Kind::Boolean, Js::Bool(_)))
                    || matches!((k, &value), (Kind::Text | Kind::Datetime, Js::Str(_)));
                if !fits || !conformance.ok(r, field, &name, k) {
                    return None;
                }
                let instant = match &value {
                    Js::Str(s) if datetime => instant_of(s),
                    _ => f64::NAN,
                };
                let (op, or_equal) = match operator {
                    "gt" => (Ordering::Greater, false),
                    "gte" => (Ordering::Greater, true),
                    "lt" => (Ordering::Less, false),
                    _ => (Ordering::Less, true),
                };
                Test::Ordered { op, or_equal, value, instant, datetime }
            }
            "contains" | "not_contains" => {
                let text = to_string(&value);
                if matches!(value, Js::Json(_)) {
                    return None;
                }
                Test::Contains(value, text, operator == "contains")
            }
            "starts_with" | "ends_with" => Test::Affix(to_string(&value)?, operator == "starts_with"),
            "empty" | "not_empty" => Test::Empty(operator == "empty"),
            "in" | "not_in" => Test::In(f.get("value").and_then(J::as_array).map(|xs| xs.iter().map(|x| value_js(Some(x))).collect()), operator == "in"),
            _ => return None,
        };
        filters.push(Filter { field, name, test });
    }

    let hidden: HashSet<&str> = q.hidden.iter().map(String::as_str).collect();
    let passes = |row: usize| -> bool {
        filters.iter().all(|f| {
            let v = js(r, row, r.cell_named(row, f.field, &f.name));
            match &f.test {
                Test::Never => false,
                Test::Eq(value, eq) => strictly_equal(&v, value) == *eq,
                Test::Ordered { op, or_equal, value, instant, datetime } => {
                    if is_empty(&v) {
                        return false;
                    }
                    let cmp = match (&v, value) {
                        (Js::Num(x), Js::Num(y)) => x.partial_cmp(y),
                        (Js::Bool(x), Js::Bool(y)) => Some(x.cmp(y)),
                        (Js::Str(x), Js::Str(y)) => {
                            let i = if *datetime { instant_of(x) } else { f64::NAN };
                            if !i.is_nan() && !instant.is_nan() {
                                i.partial_cmp(instant)
                            } else {
                                Some(utf16_cmp(x, y))
                            }
                        }
                        _ => None,
                    };
                    cmp.is_some_and(|c| c == *op || (*or_equal && c == Ordering::Equal))
                }
                Test::Contains(value, text, has) => match &v {
                    Js::Json(raw) => match items(raw) {
                        Some(xs) => xs.iter().any(|x| same_value_zero(x, value)) == *has,
                        // An object: neither an array nor a string.
                        None => false,
                    },
                    Js::Str(s) => text.as_deref().is_some_and(|t| s.contains(t) == *has),
                    _ => false,
                },
                Test::Affix(needle, starts) => matches!(&v, Js::Str(s) if if *starts { s.starts_with(needle.as_str()) } else { s.ends_with(needle.as_str()) }),
                Test::Empty(empty) => is_empty(&v) == *empty,
                Test::In(list, within) => match list {
                    None => false,
                    Some(list) => {
                        let found = match &v {
                            Js::Json(raw) => items(raw).is_some_and(|xs| xs.iter().any(|x| list.iter().any(|y| same_value_zero(y, x)))),
                            _ => list.iter().any(|y| same_value_zero(y, &v)),
                        };
                        found == *within
                    }
                },
            }
        })
    };
    let mut rows: Vec<u32> = (0..r.len()).filter(|&row| passes(row) && (hidden.is_empty() || !hidden.contains(r.id(row).as_str()))).map(|row| row as u32).collect();
    let in_view = rows.len();

    // The viewer's search: searchRows' scope, after the view.
    if let Some(needle) = &needle {
        let searched: Vec<(Option<usize>, &str)> = fields.iter().filter(|f| matches!(f.ty.as_str(), "string" | "date" | "datetime")).map(|f| (r.field(&f.name), f.name.as_str())).collect();
        // Text read where it lies in its row: a cell's bytes, unless escaped.
        let holds = |row: usize, c: Cell| match c.kind {
            kind::TEXT => bytes_fold_to(r.raw(row, c), needle),
            kind::ESCAPED => r.text(row, c).is_some_and(|t| folds_to(&t, needle)),
            _ => false,
        };
        rows.retain(|&row| {
            let row = row as usize;
            holds(row, r.id_cell(row))
                || searched.iter().any(|(f, name)| holds(row, r.cell_named(row, *f, name)))
                || (!q.bodies.is_empty() && q.bodies.get(r.id(row).as_str()).is_some_and(|b| folds_to(b, needle)))
        });
    }

    // Manual order before any sort (applyOrder): the rows it names, by their last mention, then the rest.
    if !q.order.is_empty() {
        let at: HashMap<&str, usize> = q.order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
        let (mut named, rest): (Vec<u32>, Vec<u32>) = rows.iter().partition(|&&row| at.contains_key(r.id(row as usize).as_str()));
        named.sort_by_key(|&row| at[r.id(row as usize).as_str()]);
        named.extend(rest);
        rows = named;
    } else if !q.sort.is_empty() {
        let mut keyed: Vec<(u32, Vec<Option<Key<'_>>>)> = Vec::new();
        let mut orders = Vec::new();
        for (name, _) in &q.sort {
            let Some(f) = schema.get(name.as_str()) else {
                // A key the schema doesn't name and no row holds: every cell empty, so it orders nothing.
                if r.field(name).is_some() || name == "id" || r.has_extra(name) {
                    return None;
                }
                orders.push((None, name.as_str(), None, HashMap::new()));
                continue;
            };
            let k = kind_of(&f.ty);
            if !matches!(k, Kind::Number | Kind::Boolean | Kind::Text | Kind::Datetime) || !conformance.ok(r, r.field(name), name, k) {
                return None;
            }
            orders.push((r.field(name), name.as_str(), Some(k), f.choices.iter().enumerate().map(|(i, c)| (c.as_str(), i)).collect::<HashMap<_, _>>()));
        }
        let has_choices: Vec<bool> = orders.iter().map(|o| !o.3.is_empty()).collect();
        if let [(field, name, k, choices)] = orders.as_slice() {
            // One sort, the usual case: a key a row, and no list of them.
            let desc = q.sort[0].1;
            let mut folds = Folds::default();
            let keys: Vec<Option<Key>> = rows.iter().map(|&row| k.and_then(|k| key(js(r, row as usize, r.cell_named(row as usize, *field, name)), k, choices, &mut folds))).collect();
            // Places sorted, not keys: a place is four bytes to move, a key many.
            let mut at: Vec<u32> = (0..rows.len() as u32).collect();
            at.sort_by(|&a, &b| match (&keys[a as usize], &keys[b as usize]) {
                (None, None) => Ordering::Equal,
                (None, _) => Ordering::Greater,
                (_, None) => Ordering::Less,
                (Some(x), Some(y)) => {
                    let o = x.compare(y, has_choices[0], &folds);
                    if desc { o.reverse() } else { o }
                }
            });
            rows = at.into_iter().map(|i| rows[i as usize]).collect();
        } else {
        let mut folds = Folds::default();
        for &row in &rows {
            let keys = orders
                .iter()
                .map(|(field, name, k, choices)| k.and_then(|k| key(js(r, row as usize, r.cell_named(row as usize, *field, name)), k, choices, &mut folds)))
                .collect();
            keyed.push((row, keys));
        }
        keyed.sort_by(|(_, a), (_, b)| {
            for (i, (_, desc)) in q.sort.iter().enumerate() {
                let o = match (&a[i], &b[i]) {
                    (None, None) => Ordering::Equal,
                    // Empties last, whichever way the sort runs.
                    (None, _) => return Ordering::Greater,
                    (_, None) => return Ordering::Less,
                    (Some(x), Some(y)) => x.compare(y, has_choices[i], &folds),
                };
                if o != Ordering::Equal {
                    return if *desc { o.reverse() } else { o };
                }
            }
            Ordering::Equal
        });
        rows = keyed.into_iter().map(|(row, _)| row).collect();
        }
    }

    // Groups (applyGroup, as memoryViewRows lays them out): declared choices first, then as met, empty last.
    let mut groups = Vec::new();
    if let Some(name) = &q.group {
        let field = r.field(name);
        let keys: Vec<String> = match schema.get(name.as_str()) {
            Some(f) => {
                let k = kind_of(&f.ty);
                if !matches!(k, Kind::Number | Kind::Boolean | Kind::Text | Kind::Datetime) || !conformance.ok(r, field, name, k) {
                    return None;
                }
                rows.iter().map(|&row| group_key(&js(r, row as usize, r.cell_named(row as usize, field, name)))).collect()
            }
            // A key the schema doesn't name: every row in one group, unless some row has it.
            None if !r.has_extra(name) => vec!["(empty)".to_string(); rows.len()],
            None => return None,
        };
        let mut buckets: Vec<(String, Vec<u32>)> = Vec::new();
        let mut at: HashMap<String, usize> = HashMap::new();
        for (row, k) in rows.iter().zip(keys) {
            match at.get(&k) {
                Some(&i) => buckets[i].1.push(*row),
                None => {
                    at.insert(k.clone(), buckets.len());
                    buckets.push((k, vec![*row]));
                }
            }
        }
        let choices = schema.get(name.as_str()).map(|f| f.choices.clone()).unwrap_or_default();
        let mut order: Vec<usize> = Vec::new();
        for c in &choices {
            if let Some(&i) = at.get(c) {
                if !order.contains(&i) {
                    order.push(i);
                }
            }
        }
        for (i, (k, _)) in buckets.iter().enumerate() {
            if k != "(empty)" && !order.contains(&i) {
                order.push(i);
            }
        }
        if let Some(&i) = at.get("(empty)") {
            if !order.contains(&i) {
                order.push(i);
            }
        }
        let mut laid = Vec::with_capacity(rows.len());
        for i in order {
            let (k, members) = &buckets[i];
            groups.push((k.clone(), laid.len(), members.len()));
            laid.extend_from_slice(members);
        }
        rows = laid;
    }

    // Totals over the rows shown (viewTotal).
    let totals = totals_of(r, &q.totals, Some(()), &rows);

    Some(Shown { count: rows.len(), places: Some(rows), in_view, groups, totals, place_of: std::sync::OnceLock::new() })
}

/// Totals over the rows shown (viewTotal); `rows` when `listed`, else every row.
fn totals_of(r: &Rows, totals: &[(String, String)], listed: Option<()>, rows: &[u32]) -> Vec<(String, Option<f64>)> {
    totals
        .iter()
        .map(|(name, kind)| {
            let field = r.field(name);
            let value = |row: usize| js(r, row, r.cell_named(row, field, name));
            let values: Vec<Js> = match listed {
                Some(()) => rows.iter().map(|&row| value(row as usize)).collect(),
                None => (0..r.len()).map(value).collect(),
            };
            (name.clone(), total(&values, kind))
        })
        .collect()
}

/// Whether `s` in Unicode's default lower case (`toLowerCase`) holds `needle`, which is already lower
/// case. Text that's all ASCII is folded as it's read; other text is folded whole, since some
/// letters fold to ASCII (K, the Kelvin sign) or to more than one character (İ).
fn folds_to(s: &str, needle: &str) -> bool {
    bytes_fold_to(s.as_bytes(), needle)
}

/// `folds_to` over text's UTF-8 bytes.
fn bytes_fold_to(h: &[u8], needle: &str) -> bool {
    let n = needle.as_bytes();
    if n.is_empty() {
        return true;
    }
    if !h.is_ascii() {
        return String::from_utf8_lossy(h).to_lowercase().contains(needle);
    }
    // ASCII folds to ASCII: a needle that isn't can't be in it.
    if !needle.is_ascii() || n.len() > h.len() {
        return false;
    }
    // Each place the needle's first letter is, in either case, then the rest folded as it's read.
    let (first, upper) = (n[0], n[0].to_ascii_uppercase());
    let last = h.len() - n.len();
    let mut i = 0;
    while i <= last {
        match h[i..=last].iter().position(|&b| b == first || b == upper) {
            None => return false,
            Some(p) => {
                i += p;
                if h[i + 1..i + n.len()].iter().zip(&n[1..]).all(|(a, b)| a.to_ascii_lowercase() == *b) {
                    return true;
                }
                i += 1;
            }
        }
    }
    false
}

/// A value as a sort compares it (table-core's `SortKey`), for the kinds a held table sorts. Text is
/// borrowed from its row; its lower case is made only when it isn't all ASCII.
#[derive(Debug)]
struct Key<'a> {
    kind: u8,
    num: f64,
    text: Cow<'a, str>,
    /// Where its lower case is in the sort's shared buffer (`Folds`).
    folded: (u32, u32),
    choice: i64,
    is_string: bool,
    instant: f64,
}

/// Every key's lower case, end to end: made once a sort, compared as bytes (code point order).
#[derive(Default)]
struct Folds(Vec<u8>);

impl Folds {
    fn add(&mut self, text: &str) -> (u32, u32) {
        let at = self.0.len() as u32;
        if text.is_ascii() {
            self.0.extend(text.bytes().map(|b| b.to_ascii_lowercase()));
        } else {
            self.0.extend_from_slice(text.to_lowercase().as_bytes());
        }
        (at, self.0.len() as u32 - at)
    }
    fn get(&self, (at, len): (u32, u32)) -> &[u8] {
        &self.0[at as usize..(at + len) as usize]
    }
}

fn key<'a>(v: Js<'a>, k: Kind, choices: &HashMap<&str, usize>, folds: &mut Folds) -> Option<Key<'a>> {
    if is_empty(&v) {
        return None;
    }
    let is_string = matches!(v, Js::Str(_));
    let (kind, num, text) = match v {
        Js::Num(n) => (0, n, Cow::Borrowed("")),
        Js::Bool(b) => (2, f64::from(u8::from(b)), Cow::Borrowed("")),
        Js::Str(s) => (1, 0.0, s),
        _ => (1, 0.0, Cow::Borrowed("")),
    };
    Some(Key {
        kind,
        num,
        folded: if kind == 1 { folds.add(&text) } else { (0, 0) },
        choice: if is_string && !choices.is_empty() { choices.get(text.as_ref()).map_or(-1, |&i| i as i64) } else { -1 },
        instant: if k == Kind::Datetime && is_string { instant_of(&text) } else { f64::NAN },
        is_string,
        text,
    })
}

impl Key<'_> {
    fn compare(&self, b: &Key, has_choices: bool, folds: &Folds) -> Ordering {
        // A choice sorts by its declared place, before text that isn't one.
        if has_choices && self.is_string && b.is_string {
            match (self.choice, b.choice) {
                (-1, -1) => {}
                (-1, _) => return Ordering::Greater,
                (_, -1) => return Ordering::Less,
                (x, y) => return x.cmp(&y),
            }
        }
        // By instant, not spelling.
        if !self.instant.is_nan() && !b.instant.is_nan() && self.instant != b.instant {
            return self.instant.partial_cmp(&b.instant).unwrap_or(Ordering::Equal);
        }
        if self.kind != b.kind {
            return self.kind.cmp(&b.kind);
        }
        if self.kind != 1 {
            return self.num.partial_cmp(&b.num).unwrap_or(Ordering::Equal);
        }
        // compareText: its lower case, then itself, by code point (as UTF-8 compares).
        folds.get(self.folded).cmp(folds.get(b.folded)).then_with(|| self.text.cmp(&b.text))
    }
}

fn group_key(v: &Js) -> String {
    match v {
        _ if is_empty(v) => "(empty)".into(),
        Js::Num(n) => number_text(*n),
        Js::Bool(b) => b.to_string(),
        Js::Str(s) => s.to_string(),
        _ => "(empty)".into(),
    }
}

/// `viewTotal` over a column's values.
fn total(values: &[Js], kind: &str) -> Option<f64> {
    let blank = |v: &Js| is_empty(v) || matches!(v, Js::Json(raw) if items(raw).is_some_and(|xs| xs.is_empty()));
    match kind {
        "count" => return Some(values.iter().filter(|v| !blank(v)).count() as f64),
        "count_empty" => return Some(values.iter().filter(|v| blank(v)).count() as f64),
        _ => {}
    }
    let nums: Vec<f64> = values.iter().filter_map(|v| match v {
        Js::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }).collect();
    if nums.is_empty() {
        return None;
    }
    match kind {
        "sum" => Some(exact_sum(&nums)),
        "average" => Some(exact_sum(&nums) / nums.len() as f64),
        // Math.min and Math.max: -0 below 0.
        "min" => Some(nums.iter().copied().fold(f64::INFINITY, |m, x| if x < m || (x == 0.0 && m == 0.0 && x.is_sign_negative()) { x } else { m })),
        "max" => Some(nums.iter().copied().fold(f64::NEG_INFINITY, |m, x| if x > m || (x == 0.0 && m == 0.0 && m.is_sign_negative()) { x } else { m })),
        _ => None,
    }
}

/// The exact sum of some numbers, rounded once (table-core's `exactSum`: Shewchuk's, as Python's fsum).
pub fn exact_sum(values: &[f64]) -> f64 {
    let mut partials: Vec<f64> = Vec::new();
    for &v in values {
        let mut x = v;
        let mut kept = 0;
        for i in 0..partials.len() {
            let mut y = partials[i];
            if x.abs() < y.abs() {
                std::mem::swap(&mut x, &mut y);
            }
            let hi = x + y;
            let lo = y - (hi - x);
            if lo != 0.0 {
                partials[kept] = lo;
                kept += 1;
            }
            x = hi;
        }
        partials.truncate(kept);
        partials.push(x);
    }
    let mut n = partials.len();
    if n == 0 {
        return 0.0;
    }
    n -= 1;
    let mut hi = partials[n];
    let mut lo = 0.0;
    while n > 0 {
        let x = hi;
        n -= 1;
        let y = partials[n];
        hi = x + y;
        lo = y - (hi - x);
        if lo != 0.0 {
            break;
        }
    }
    if n > 0 && ((lo < 0.0 && partials[n - 1] < 0.0) || (lo > 0.0 && partials[n - 1] > 0.0)) {
        let y = lo * 2.0;
        let x = hi + y;
        if y == x - hi {
            hi = x;
        }
    }
    hi
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_as_javascript_writes_them() {
        for (n, s) in [(5.0, "5"), (-0.0, "0"), (0.1 + 0.2, "0.30000000000000004"), (1e21, "1e+21"), (1e-7, "1e-7"), (123456789012.5, "123456789012.5"), (-2.5, "-2.5")] {
            assert_eq!(number_text(n), s, "{n}");
        }
    }

    #[test]
    fn sums_are_exact_whatever_the_order() {
        assert_eq!(exact_sum(&[0.1, 0.2, 0.3]), 0.6);
        assert_eq!(exact_sum(&[1e16, 1.0, -1e16]), 1.0);
        assert_eq!(exact_sum(&[]), 0.0);
    }

    #[test]
    fn utf16_order_is_javascripts() {
        // U+FF21 is before U+10000 by code point, after it by UTF-16 unit (U+10000 is a surrogate pair from U+D800).
        assert_eq!(utf16_cmp("\u{ff21}", "\u{10000}"), Ordering::Greater);
        assert_eq!("\u{ff21}".cmp("\u{10000}"), Ordering::Less);
    }
}
