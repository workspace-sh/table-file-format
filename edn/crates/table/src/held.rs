//! Tables whose rows the engine holds, by handle, and the operations on them
//! (`rows.*`), in the three shapes a binding exports: `call` (JSON in and
//! out), `call_bytes` (JSON and a file's bytes in, JSON out) and `window`
//! (JSON in, rows out as typed arrays).

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value as J;

use crate::rows::{kind, LineIs, Rows};
use crate::view::{self, Conformance, Shown};

static HELD: Mutex<Option<Held>> = Mutex::new(None);

#[derive(Default)]
struct Held {
    next: u32,
    tables: HashMap<u32, Table>,
    /// Checks of tables whose rows are being read, a file at a time (`check.*`).
    checks: HashMap<u32, crate::problems::Checker>,
}

/// How many views of a table are kept; one asked again after it's gone is worked out again.
const VIEWS_KEPT: usize = 8;

/// How many problems there are, of each kind, for the query (as JSON) they're of.
type Totals = (String, usize, Vec<(String, usize)>);

/// A held table: its rows, which of its fields hold their kind, its latest views, and its problems as last asked.
struct Table {
    rows: Rows,
    conformance: Conformance,
    views: Vec<(u32, Shown)>,
    next_view: u32,
    problems: Option<(String, crate::problems::Problems)>,
    /// How many problems there are of each kind, for the query they're of: kept up by each edit.
    problem_totals: Option<Totals>,
    /// The rows a batch in runs has taken out so far, by the batch's name (`batch`).
    carried: Option<(String, crate::edit::Carried)>,
}

impl Table {
    fn view(&self, input: &J) -> Result<&Shown, String> {
        let v = input.get("view").and_then(J::as_u64).ok_or("the input needs \"view\", a number")? as u32;
        self.views.iter().find(|(id, _)| *id == v).map(|(_, s)| s).ok_or_else(|| format!("no view {v}: ask for it again"))
    }
}

fn with<T>(f: impl FnOnce(&mut Held) -> T) -> T {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    f(held.get_or_insert_with(Held::default))
}

fn handle(input: &J) -> Result<u32, String> {
    input.get("handle").and_then(J::as_u64).map(|h| h as u32).ok_or_else(|| "the input needs \"handle\", a number".to_string())
}

fn held<T>(input: &J, f: impl FnOnce(&mut Rows) -> Result<T, String>) -> Result<T, String> {
    table(input, |t| f(&mut t.rows))
}

fn table<T>(input: &J, f: impl FnOnce(&mut Table) -> Result<T, String>) -> Result<T, String> {
    let h = handle(input)?;
    with(|held| held.tables.get_mut(&h).ok_or_else(|| format!("no table is held as {h}")).and_then(f))
}

fn checking<T>(input: &J, f: impl FnOnce(&mut crate::problems::Checker) -> Result<T, String>) -> Result<T, String> {
    let h = handle(input)?;
    with(|held| held.checks.get_mut(&h).ok_or_else(|| format!("no check is held as {h}")).and_then(f))
}

/// A view's query from its JSON (table-core's IndexQuery, its schema's fields, and the pages searched).
fn query_of(input: &J) -> Result<(Vec<view::Field>, view::Query), String> {
    let fields = input
        .get("fields")
        .and_then(J::as_array)
        .ok_or("the input needs \"fields\": the schema's, with their types and choices")?
        .iter()
        .map(|f| view::Field {
            name: f.get("name").and_then(J::as_str).unwrap_or_default().to_string(),
            ty: f.get("type").and_then(J::as_str).unwrap_or("string").to_string(),
            choices: f.get("choices").and_then(J::as_array).map(|c| c.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        })
        .collect();
    let q = input.get("query").cloned().unwrap_or(J::Null);
    let strings = |v: Option<&J>| v.and_then(J::as_array).map(|xs| xs.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    Ok((
        fields,
        view::Query {
            filter: q.get("filter").and_then(J::as_array).cloned().unwrap_or_default(),
            hidden: strings(q.get("hidden")),
            search: q.get("search").and_then(J::as_str).map(str::to_string),
            order: strings(q.get("order")),
            sort: q
                .get("sort")
                .and_then(J::as_array)
                .map(|xs| xs.iter().filter_map(|s| Some((s.get("field")?.as_str()?.to_string(), s.get("direction").and_then(J::as_str) == Some("desc")))).collect())
                .unwrap_or_default(),
            group: q.get("group").and_then(J::as_str).map(str::to_string),
            totals: q.get("totals").and_then(J::as_object).map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect()).unwrap_or_default(),
            bodies: input.get("bodies").and_then(J::as_object).map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect()).unwrap_or_default(),
        },
    ))
}

/// `rows.problems`: a held table's problems, counted by code, and a window of them (`from`, `to`).
/// Worked out once for a query and kept, so its windows are read without working it out again.
fn problems(input: &J) -> Result<String, String> {
    let h = handle(input)?;
    let mut query = input.clone();
    if let Some(o) = query.as_object_mut() {
        o.remove("from");
        o.remove("to");
    }
    let key = query.to_string();
    let from = input.get("from").and_then(J::as_u64).unwrap_or(0) as usize;
    let to = input.get("to").and_then(J::as_u64).map_or(0, |x| x as usize);
    with(|held| {
        let targets = targets_of(held, input)?;
        let t = held.tables.get_mut(&h).ok_or_else(|| format!("no table is held as {h}"))?;
        if t.problems.as_ref().map(|(k, _)| k) != Some(&key) {
            match crate::problems::problems(&t.rows, input, &targets)? {
                Some(p) => t.problems = Some((key, p)),
                None => return Ok("null".into()),
            }
        }
        let (_, p) = t.problems.as_ref().expect("just worked out");
        let mut out = String::from("{\"total\":");
        out.push_str(&p.found.len().to_string());
        out.push_str(",\"counts\":{");
        for (i, (code, n)) in p.counts.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!("\"{code}\":{n}"));
        }
        out.push_str("},\"found\":");
        out.push_str(&p.window(&t.rows, from, to));
        out.push('}');
        Ok(out)
    })
}

/// A relation's target: the ids its rows hold, from a table held here or as the caller gives them.
fn targets_of(held: &Held, input: &J) -> Result<crate::problems::Targets, String> {
    let mut targets = crate::problems::Targets::new();
    for (field, target) in input.get("targets").and_then(J::as_object).into_iter().flatten() {
        let ids: std::collections::HashSet<String> = match (target.get("handle").and_then(J::as_u64), target.get("ids").and_then(J::as_array)) {
            (Some(t), _) => {
                let other = held.tables.get(&(t as u32)).ok_or_else(|| format!("no table is held as {t}"))?;
                (0..other.rows.len()).map(|r| other.rows.id(r)).collect()
            }
            (None, Some(ids)) => ids.iter().filter_map(|s| s.as_str().map(str::to_string)).collect(),
            _ => continue,
        };
        targets.insert(field.clone(), ids);
    }
    Ok(targets)
}


/// `rows.apply`: changes to a held table's rows (step 3a, `edit.rs`). With `problems` (what
/// `rows.problems` is asked), the problems the changes made and the ones they ended.
/// Each problem counted, so one said twice and now once is one ended: what `after` has that `before`
/// hadn't, and what `before` had that `after` hasn't.
fn changed_problems<'a>(before: &'a [String], after: &'a [String]) -> (Vec<&'a str>, Vec<&'a str>) {
    let less = |from: &'a [String], take: &'a [String]| {
        let mut left: HashMap<&str, usize> = HashMap::new();
        for s in take {
            *left.entry(s.as_str()).or_default() += 1;
        }
        let mut out = Vec::new();
        for s in from {
            match left.get_mut(s.as_str()) {
                Some(n) if *n > 0 => *n -= 1,
                _ => out.push(s.as_str()),
            }
        }
        out
    };
    (less(after, before), less(before, after))
}

/// A problem's code, from its JSON (`{"code":"…",…}`).
fn code_of(said: &str) -> &str {
    said.strip_prefix("{\"code\":\"").and_then(|r| r.split('"').next()).unwrap_or("")
}

fn apply(input: &J) -> Result<String, String> {
    let h = handle(input)?;
    with(|held| {
        let asked = input.get("problems").filter(|p| p.is_object()).cloned();
        let targets = match &asked {
            Some(p) => Some(targets_of(held, p)?),
            None => None,
        };
        let t = held.tables.get_mut(&h).ok_or_else(|| format!("no table is held as {h}"))?;
        // A batch given in runs (`batch`, its name): the rows its earlier runs took out, which its
        // later ones may bring back, as applyChanges brings them back.
        let batch = input.get("batch").and_then(J::as_str).map(str::to_string);
        let carried = match (t.carried.take(), &batch) {
            (Some((name, rows)), Some(b)) if name == *b => rows,
            _ => crate::edit::Carried::new(),
        };
        // The problems a batch could change, before it: its rows and the values they hold before and
        // after it (the batch tried and taken back), never the whole table again.
        let mut scoped_before = None;
        if let (Some(p), Some(targets)) = (&asked, &targets) {
            let key = p.to_string();
            // How many there are, of each kind: worked out whole once, then kept up by each batch.
            if t.problem_totals.as_ref().is_none_or(|(k, _, _)| *k != key) {
                t.problem_totals = crate::problems::problems(&t.rows, p, targets)?.map(|all| (key.clone(), all.found.len(), all.counts.iter().map(|(c, n)| (c.to_string(), *n)).collect()));
            }
            if t.problem_totals.is_some() {
                let (named, after) = crate::edit::named_after(&mut t.rows, input, &carried)?;
                let mut values: Vec<serde_json::Map<String, J>> = Vec::new();
                for id in &named {
                    if let Some(row) = t.rows.row_of(id) {
                        if let Ok(J::Object(m)) = serde_json::from_slice::<J>(t.rows.line(row)) {
                            values.push(m);
                        }
                    }
                    if let Some(Some(m)) = after.get(id) {
                        values.push(m.clone());
                    }
                }
                let schema = p.get("schema").cloned().unwrap_or(J::Null);
                if let Some(scope) = crate::problems::Scope::of(&t.rows, &schema, named, &values.iter().collect::<Vec<_>>())? {
                    scoped_before = crate::problems::scoped(&t.rows, p, targets, &scope)?.map(|said| (scope, said));
                }
            }
        }
        let mut carried = carried;
        let applied = match crate::edit::apply_carrying(&mut t.rows, input, &mut carried) {
            Ok(a) => a,
            Err(e) => {
                // Nothing changed: what the batch carried stays for it.
                t.carried = batch.map(|b| (b, carried));
                return Err(e);
            }
        };
        // Kept for the batch's next run; a call that isn't one of a batch's carries nothing on.
        t.carried = batch.map(|b| (b, carried));
        // What was worked out of the rows before is of other rows now.
        if !applied.changed.is_empty() {
            t.views.clear();
            t.problems = None;
            t.conformance = Conformance::new();
            // Kept up only by a batch that asks: one that doesn't leaves them to be counted again.
            if scoped_before.is_none() {
                t.problem_totals = None;
            }
        }
        let mut out = String::from("{\"changed\":");
        out.push_str(&crate::edit::json(&J::from(applied.changed)));
        out.push_str(",\"events\":");
        out.push_str(&crate::edit::json(&J::Array(applied.events)));
        out.push_str(",\"effects\":");
        out.push_str(&crate::edit::json(&J::Array(applied.effects)));
        if let (Some(p), Some(targets), Some((scope, was))) = (&asked, &targets, scoped_before) {
            if let Some(said) = crate::problems::scoped(&t.rows, p, targets, &scope)? {
                let (found, gone) = changed_problems(&was, &said);
                let (key, mut total, mut counts) = t.problem_totals.take().expect("worked out above");
                for s in &gone {
                    total -= 1;
                    if let Some(c) = counts.iter_mut().find(|(c, _)| c == code_of(s)) {
                        c.1 -= 1;
                    }
                }
                for s in &found {
                    total += 1;
                    match counts.iter_mut().find(|(c, _)| c == code_of(s)) {
                        Some(c) => c.1 += 1,
                        None => counts.push((code_of(s).to_string(), 1)),
                    }
                }
                counts.retain(|(_, n)| *n > 0);
                out.push_str(&format!(",\"problems\":{{\"total\":{total},\"counts\":{{"));
                for (i, (code, n)) in counts.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&format!("\"{code}\":{n}"));
                }
                out.push_str("},\"found\":[");
                out.push_str(&found.join(","));
                out.push_str("],\"gone\":[");
                out.push_str(&gone.join(","));
                out.push_str("]}");
                t.problem_totals = Some((key, total, counts));
            }
        }
        out.push('}');
        Ok(out)
    })
}

fn number(n: f64) -> String {
    if n.is_finite() { n.to_string() } else { "null".into() }
}

/// `rows.*` operations of `call`, as JSON. None when `op` isn't one.
pub(crate) fn call(op: &str, input: &J) -> Option<Result<String, String>> {
    Some(match op {
        "rows.new" => {
            let fields: Vec<String> = match input.get("fields").and_then(J::as_array) {
                Some(f) => f.iter().filter_map(|n| n.as_str().map(str::to_string)).collect(),
                None => return Some(Err("the input needs \"fields\", a list of names".into())),
            };
            // A window names a field by its index, below the codes for the id and a key the schema doesn't name.
            if fields.len() >= usize::from(ID) {
                return Some(Err(format!("a held table has at most {} fields; this schema has {}", ID, fields.len())));
            }
            Ok(with(|held| {
                held.next += 1;
                held.tables.insert(held.next, Table { rows: Rows::new(&fields), conformance: Conformance::new(), views: Vec::new(), next_view: 0, problems: None, problem_totals: None, carried: None });
                held.next.to_string()
            }))
        }
        "rows.free" => handle(input).map(|h| with(|held| held.tables.remove(&h).is_some()).to_string()),
        // A check of a table's rows as they're read (step 2c): begun, each file ended, then finished.
        "check.new" => crate::problems::Checker::new(input).map(|c| match c {
            Some(c) => with(|held| {
                held.next += 1;
                held.checks.insert(held.next, c);
                held.next.to_string()
            }),
            None => "null".into(),
        }),
        "check.begin" => {
            let name = input.get("file").and_then(J::as_str).unwrap_or("rows");
            checking(input, |c| {
                c.begin_file(name);
                Ok("true".to_string())
            })
        }
        "check.file" => {
            let name = input.get("file").and_then(J::as_str).unwrap_or("rows");
            checking(input, |c| c.end_file(name).map(|n| n.to_string()))
        }
        "check.finish" => handle(input).and_then(|h| with(|held| held.checks.remove(&h)).map(|c| c.finish()).ok_or_else(|| format!("no check is held as {h}"))),
        "check.free" => handle(input).map(|h| with(|held| held.checks.remove(&h).is_some()).to_string()),
        "check.rules" => Ok(crate::problems::RULES.to_string()),
        "rows.count" => held(input, |r| Ok(r.len().to_string())),
        "rows.query" => table(input, |t| {
            let (fields, q) = query_of(input)?;
            let Some(shown) = view::view(&t.rows, &fields, &q, &mut t.conformance) else { return Ok("null".into()) };
            t.next_view += 1;
            let id = t.next_view;
            let mut out = format!("{{\"view\":{id},\"count\":{},\"inView\":{},\"groups\":[", shown.count, shown.in_view);
            for (i, (key, start, count)) in shown.groups.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str("{\"key\":");
                workspace_edn::formula::json_string(&mut out, key);
                out.push_str(&format!(",\"start\":{start},\"count\":{count}}}"));
            }
            out.push_str("],\"totals\":{");
            for (i, (field, total)) in shown.totals.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                workspace_edn::formula::json_string(&mut out, field);
                out.push(':');
                out.push_str(&total.map_or("null".into(), number));
            }
            out.push_str("}}");
            if t.views.len() >= VIEWS_KEPT {
                t.views.remove(0);
            }
            t.views.push((id, shown));
            Ok(out)
        }),
        "rows.problems" => problems(input),
        "rows.apply" => apply(input),
        "rows.ids" => table(input, |t| {
            let shown = t.view(input)?;
            let from = input.get("from").and_then(J::as_u64).unwrap_or(0) as usize;
            let to = input.get("to").and_then(J::as_u64).map_or(shown.count, |x| x as usize);
            let mut out = String::from("[");
            for (i, row) in shown.rows(from, to).into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                workspace_edn::formula::json_string(&mut out, &t.rows.id(row));
            }
            out.push(']');
            Ok(out)
        }),
        "rows.place" => table(input, |t| {
            let shown = t.view(input)?;
            let id = input.get("id").and_then(J::as_str).ok_or("the input needs \"id\", as text")?;
            Ok(t.rows.row_of(id).and_then(|row| shown.place(row as u32)).map_or(-1, i64::from).to_string())
        }),
        "rows.bytes" => held(input, |r| Ok(r.bytes().to_string())),
        "rows.lines" => held(input, |r| {
            let from = input.get("from").and_then(J::as_u64).unwrap_or(0) as usize;
            // Asked for first: a file of short lines that aren't rows answers in many times its size.
            let size = r.lines().iter().skip(from).fold(2usize, |n, l| n.saturating_add(96).saturating_add((l.len as usize).saturating_mul(6)));
            let mut out = String::new();
            out.try_reserve_exact(size).map_err(|_| "the lines that aren't rows are too many to give back at once".to_string())?;
            out.push('[');
            for (i, l) in r.lines().iter().enumerate().skip(from) {
                if i > from {
                    out.push(',');
                }
                let (is, first) = match l.is {
                    LineIs::NotJson => ("not-json", None),
                    LineIs::NotRow => ("not-row", None),
                    LineIs::NoId => ("no-id", None),
                    LineIs::Repeat(first) => ("repeat", Some(first)),
                };
                out.push_str(&format!("{{\"file\":{},\"line\":{},\"is\":\"{is}\",\"rowsBefore\":{}", l.file, l.line, l.rows_before));
                if let Some(f) = first {
                    out.push_str(&format!(",\"first\":{f}"));
                }
                out.push_str(",\"text\":");
                workspace_edn::formula::json_string(&mut out, &String::from_utf8_lossy(r.unread(l)));
                out.push('}');
            }
            out.push(']');
            Ok(out)
        }),
        _ => return None,
    })
}

/// `rows.read`: a rows file's bytes into a held table, inflated first when the input names the zip
/// entry's `method`, `size` and `crc`. Its answer is how many rows it held.
pub(crate) fn call_bytes(op: &str, input: &J, bytes: &[u8]) -> Result<String, String> {
    match op {
        "rows.read" => {
            let name = input.get("file").and_then(J::as_str).unwrap_or("rows");
            let bytes = match input.get("method").and_then(J::as_u64) {
                Some(method) => {
                    let size = input.get("size").and_then(J::as_u64).ok_or("the input needs \"size\" with \"method\"")? as usize;
                    let crc = input.get("crc").and_then(J::as_u64).ok_or("the input needs \"crc\" with \"method\"")? as u32;
                    crate::rows::inflate(name, method as u32, bytes, size, crc)?
                }
                None => bytes.to_vec(),
            };
            let strip_bom = input.get("stripBom").and_then(J::as_bool).unwrap_or(true);
            held(input, |r| r.read(name, bytes, strip_bom).map(|n| n.to_string()))
        }
        "check.piece" => checking(input, |c| c.piece(bytes).map(|()| "true".to_string())),
        _ => Err(format!("{op:?} isn't an operation that takes bytes; there are rows.read and check.piece")),
    }
}

/// Rows as they cross back: per row, its keys in the order its line writes them, each with its
/// kind and its value in the stream that kind reads from.
///
/// - `entries`: per row, how many keys it has, then each key: a field's index in the schema,
///   `ID` for the id, or `EXTRA` for a key the schema doesn't name (its name is the next text).
/// - `kinds`: per key, its kind (`rows::kind`).
/// - `numbers`: per number, its value.
/// - `texts`: every text, one after another (texts, escaped texts decoded, arrays and objects as
///   written, extra keys' names); `ends`: where each ends, in UTF-16 code units, so JavaScript
///   slices it as it is.
#[derive(Default, Debug)]
pub struct Window {
    pub entries: Vec<u16>,
    pub kinds: Vec<u8>,
    pub numbers: Vec<f64>,
    pub texts: String,
    pub ends: Vec<u32>,
}

pub const ID: u16 = 0xfffe;
pub const EXTRA: u16 = 0xffff;

impl Window {
    fn text(&mut self, s: &str, units: &mut u32) {
        self.texts.push_str(s);
        *units += if s.is_ascii() { s.len() as u32 } else { s.encode_utf16().count() as u32 };
        self.ends.push(*units);
    }
}

/// `rows.window`: rows `from` up to `to` of a held table.
pub(crate) fn window(op: &str, input: &J) -> Result<Window, String> {
    if op != "rows.window" {
        return Err(format!("{op:?} isn't an operation that gives rows; there is rows.window"));
    }
    table(input, |t| {
        let from = input.get("from").and_then(J::as_u64).unwrap_or(0) as usize;
        // A view's rows in its order, or the table's in file order.
        let list: Vec<usize> = match (input.get("view"), input.get("ids").and_then(J::as_array)) {
            // Rows by id, in the order asked; an id the table hasn't is passed over.
            (_, Some(ids)) => ids.iter().filter_map(|id| id.as_str().and_then(|id| t.rows.row_of(id))).collect(),
            (view, None) => match view {
            Some(_) => {
                let shown = t.view(input)?;
                let to = input.get("to").and_then(J::as_u64).map_or(shown.count, |x| x as usize);
                shown.rows(from, to)
            }
            None => {
                let to = input.get("to").and_then(J::as_u64).map_or(t.rows.len(), |x| x as usize).min(t.rows.len());
                (from.min(to)..to).collect()
            }
            },
        };
        let r = &t.rows;
        // Counted first, and asked for: a window is never grown on the way.
        let (mut entries, mut numbers, mut texts, mut text_bytes) = (0usize, 0usize, 0usize, 0usize);
        for &row in &list {
            let keys = 1 + r.cells(row).iter().filter(|c| c.kind != kind::ABSENT).count() + r.extras(row).len();
            if keys > usize::from(u16::MAX) {
                return Err(format!("row {row} has {keys} keys, more than a window can carry ({})", u16::MAX));
            }
            entries += 1 + keys;
            for c in std::iter::once(&r.id_cell(row)).chain(r.cells(row)).chain(r.extras(row).iter().map(|e| &e.value)) {
                match c.kind {
                    kind::NUMBER => numbers += 1,
                    kind::TEXT | kind::ESCAPED | kind::JSON => {
                        texts += 1;
                        text_bytes += c.len as usize;
                    }
                    _ => {}
                }
            }
            for e in r.extras(row) {
                texts += 1;
                text_bytes += e.key.len();
            }
        }
        let keys = entries - list.len();
        let mut w = Window::default();
        let too_large = |_| "the rows asked for are too many to give back at once".to_string();
        w.entries.try_reserve_exact(entries).map_err(too_large)?;
        w.kinds.try_reserve_exact(keys).map_err(too_large)?;
        w.numbers.try_reserve_exact(numbers).map_err(too_large)?;
        w.ends.try_reserve_exact(texts).map_err(too_large)?;
        // Decoding escapes only ever shortens a text.
        w.texts.try_reserve_exact(text_bytes).map_err(too_large)?;
        let mut units = 0u32;
        let mut row_keys: Vec<(u32, u16, crate::rows::Cell, Option<String>)> = Vec::new();
        for &row in &list {
            row_keys.clear();
            // The id, then each field and each extra key, put back in the order the line writes them.
            let id = r.id_cell(row);
            row_keys.push((id.start, ID, id, None));
            for (f, c) in r.cells(row).iter().enumerate() {
                if c.kind != kind::ABSENT {
                    row_keys.push((c.start, f as u16, *c, None));
                }
            }
            for e in r.extras(row) {
                row_keys.push((e.value.start, EXTRA, e.value, Some(e.key.clone())));
            }
            row_keys.sort_by_key(|k| k.0);
            w.entries.push(row_keys.len() as u16);
            for (_, key, c, name) in &row_keys {
                w.entries.push(*key);
                w.kinds.push(c.kind);
                if let Some(name) = name {
                    w.text(name, &mut units);
                }
                match c.kind {
                    kind::NUMBER => w.numbers.push(std::str::from_utf8(r.raw(row, *c)).ok().and_then(|n| n.parse().ok()).unwrap_or(f64::NAN)),
                    kind::TEXT | kind::ESCAPED => {
                        let t = r.text(row, *c).unwrap_or_default();
                        w.text(&t, &mut units);
                    }
                    kind::JSON => {
                        let raw = String::from_utf8_lossy(r.raw(row, *c)).into_owned();
                        w.text(&raw, &mut units);
                    }
                    _ => {}
                }
            }
        }
        Ok(w)
    })
}

#[cfg(test)]
mod tests {
    use crate::{call, call_bytes, window};

    fn value(answer: &str) -> serde_json::Value {
        serde_json::from_str::<serde_json::Value>(answer).unwrap()["value"].clone()
    }

    #[test]
    fn a_table_held_read_and_given_back_in_its_keys_order() {
        let h = value(&call("rows.new", r#"{"fields":["t","n"]}"#));
        let input = format!(r#"{{"handle":{h},"file":"rows/0001.ndjson"}}"#);
        let text = "{\"n\":1.5,\"id\":\"a\",\"t\":\"x\\u00e9\",\"z\":{\"k\":[1]}}\nnope\n{\"id\":\"b\",\"t\":\"🙂\"}\n";
        assert_eq!(value(&call_bytes("rows.read", &input, text.as_bytes())), 2);
        let deflated = miniz_oxide::deflate::compress_to_vec(b"{\"id\":\"c\"}", 6);
        let zipped = format!(r#"{{"handle":{h},"file":"rows/0002.ndjson","method":8,"size":10,"crc":{}}}"#, crate::rows::crc32(b"{\"id\":\"c\"}"));
        assert_eq!(value(&call_bytes("rows.read", &zipped, &deflated)), 1);
        assert_eq!(value(&call("rows.count", &format!(r#"{{"handle":{h}}}"#))), 3);
        let lines = value(&call("rows.lines", &format!(r#"{{"handle":{h}}}"#)));
        assert_eq!(lines[0]["is"], "not-json");
        assert_eq!(lines[0]["text"], "nope");
        assert_eq!(lines[0]["rowsBefore"], 1);

        let w = window("rows.window", &format!(r#"{{"handle":{h},"from":0,"to":2}}"#)).unwrap();
        // Row a: n, id, t, z (an extra key); row b: id, t.
        assert_eq!(w.entries, vec![4, 1, super::ID, 0, super::EXTRA, 2, super::ID, 0]);
        assert_eq!(w.numbers, vec![1.5]);
        assert_eq!(w.texts, "axéz{\"k\":[1]}b🙂");
        // UTF-16 ends: "a", "xé", "z", "{\"k\":[1]}", "b", "🙂" (two units).
        assert_eq!(w.ends, vec![1, 3, 4, 13, 14, 16]);
        assert!(call("rows.free", &format!(r#"{{"handle":{h}}}"#)).contains("true"));
        let _ = deflated;
        assert!(call("rows.count", &format!(r#"{{"handle":{h}}}"#)).contains("error"));
    }


    #[test]
    fn what_a_file_declares_or_holds_past_what_can_be_held_is_an_error() {
        // A hostile entry: two bytes declaring 2^45, through the binding's own call.
        let h = value(&call("rows.new", r#"{"fields":[]}"#));
        let hostile = format!(r#"{{"handle":{h},"file":"rows/0001.ndjson","method":8,"size":35184372088832,"crc":0}}"#);
        let answer = call_bytes("rows.read", &hostile, &[0x03, 0x00]);
        assert!(answer.starts_with(r#"{"error":"corrupt zip: rows/0001.ndjson declares"#), "{answer}");
        // A row with more keys than a window can carry.
        let mut line = String::from("{\"id\":\"wide\"");
        for k in 0..70_000 {
            line.push_str(&format!(",\"k{k}\":1"));
        }
        line.push('}');
        assert_eq!(value(&call_bytes("rows.read", &format!(r#"{{"handle":{h}}}"#), line.as_bytes())), 1);
        let err = window("rows.window", &format!(r#"{{"handle":{h},"from":0,"to":1}}"#)).unwrap_err();
        assert!(err.contains("70001 keys, more than a window can carry"), "{err}");
        // A window past the table's end is the rows there are.
        assert_eq!(window("rows.window", &format!(r#"{{"handle":{h},"from":5,"to":9}}"#)).unwrap().entries.len(), 0);
        call("rows.free", &format!(r#"{{"handle":{h}}}"#));
        // More fields than a window can name.
        let fields: Vec<String> = (0..0xfffe).map(|i| format!("\"f{i}\"")).collect();
        let too_many = call("rows.new", &format!(r#"{{"fields":[{}]}}"#, fields.join(",")));
        assert!(too_many.contains("at most 65534 fields"), "{too_many}");
    }
}
