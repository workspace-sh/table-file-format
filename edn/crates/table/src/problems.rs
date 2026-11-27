//! A held table's problems (table-file-format#867, step 2b): what table-core's
//! `foundInRows` finds in its rows, its pages and its optional warnings, in the
//! same order, as codes and places. Their words and fixes are made in
//! TypeScript (`problemOf`), for the problems a person looks at; how many of
//! each kind there are needs no row to cross.
//!
//! Each problem is held as a few numbers (its code, row, field, and what it
//! points at), so a million of them stay small, and its details are written
//! only for a window asked for. A table it can't promise memory's answer for
//! (a `pattern` constraint, a JavaScript RegExp) isn't answered.

use std::collections::{HashMap, HashSet};

use serde_json::Value as J;

use crate::encoding::{instant_of, is_date, is_date_time, is_duration, is_geojson, is_geopoint, is_time, is_year_month};
use crate::rows::Rows;
use crate::view::{self, js, utf16_cmp, Js};
use workspace_edn::formula::json_string;

/// What kind of problem, in table-core's codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Code {
    Required,
    Type,
    Choice,
    Minimum,
    Maximum,
    ExclusiveMinimum,
    ExclusiveMaximum,
    MinLength,
    MaxLength,
    Unique,
    KeyPrimary,
    KeyUnique,
    BodyOrphaned,
    RelationDangling,
    ChoiceUnused,
    AttachmentOrphaned,
}

impl Code {
    fn name(self) -> &'static str {
        match self {
            Code::Required => "value.required",
            Code::Type => "value.type",
            Code::Choice => "value.choice",
            Code::Minimum => "value.minimum",
            Code::Maximum => "value.maximum",
            Code::ExclusiveMinimum => "value.exclusive-minimum",
            Code::ExclusiveMaximum => "value.exclusive-maximum",
            Code::MinLength => "value.min-length",
            Code::MaxLength => "value.max-length",
            Code::Unique => "value.unique",
            Code::KeyPrimary => "key.primary",
            Code::KeyUnique => "key.unique",
            Code::BodyOrphaned => "body.orphaned",
            Code::RelationDangling => "relation.dangling",
            Code::ChoiceUnused => "choice.unused",
            Code::AttachmentOrphaned => "attachment.orphaned",
        }
    }
}

const NONE: u32 = u32::MAX;

/// A problem as held: its code, its row, its field, and what it points at (the
/// row holding the same value first, an item's place in a list, which key,
/// which page, choice or file); NONE where there's none.
#[derive(Clone, Copy, Debug)]
pub struct Found {
    code: Code,
    row: u32,
    field: u32,
    at: u32,
    key: u32,
}

/// A schema field as its rows are checked.
struct Field {
    name: String,
    ty: String,
    computed: bool,
    relation_many: bool,
    relation_table: Option<String>,
    attachment: bool,
    required: bool,
    unique: bool,
    choices: Vec<String>,
    bounds: [Option<J>; 4],
    min_length: Option<f64>,
    max_length: Option<f64>,
    index: Option<usize>,
}

/// JavaScript truthiness of a JSON value.
fn truthy(v: Option<&J>) -> bool {
    match v {
        None | Some(J::Null) => false,
        Some(J::Bool(b)) => *b,
        Some(J::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(J::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// What a table's rows are checked against: its fields, and its keys in order (its primary key, then its unique keys).
pub(crate) struct Spec {
    fields: Vec<Field>,
    keys: Vec<(Code, Vec<String>)>,
}

/// The problems asked for, and everything needed to say a window of them.
pub struct Problems {
    spec: Spec,
    bodies: Vec<String>,
    attachments: Vec<String>,
    pub found: Vec<Found>,
    pub counts: Vec<(&'static str, usize)>,
}

/// What a relation's target holds: its rows' ids, when it's in the bundle and its rows can be read.
pub type Targets = HashMap<String, HashSet<String>>;

/// The version of what a check finds: raised whenever a change here finds something else in the
/// same rows (a rule added, a problem's details said otherwise), so a check kept from before reads
/// as not checked.
pub const RULES: u32 = 1;

fn strings(v: Option<&J>) -> Vec<String> {
    v.and_then(J::as_array).map(|x| x.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// A schema as its rows are checked, or None when the engine can't promise what memory gives.
pub(crate) fn spec(r: &Rows, schema: &J) -> Result<Option<Spec>, String> {
    let mut fields = Vec::new();
    for f in schema.get("fields").and_then(J::as_array).ok_or("the schema needs \"fields\"")? {
        let c = f.get("constraints");
        let get = |k: &str| c.and_then(|c| c.get(k));
        let computed = truthy(f.get("computed"));
        if !computed && get("pattern").is_some() {
            // A pattern is a JavaScript RegExp: the engine doesn't promise to read it as JavaScript does.
            return Ok(None);
        }
        let length = |k: &str| -> Result<Option<f64>, ()> {
            match get(k) {
                None => Ok(None),
                Some(J::Number(n)) => Ok(n.as_f64()),
                Some(_) => Err(()),
            }
        };
        let (Ok(min_length), Ok(max_length)) = (length("minLength"), length("maxLength")) else { return Ok(None) };
        let name = f.get("name").and_then(J::as_str).unwrap_or_default().to_string();
        fields.push(Field {
            index: r.field(&name),
            ty: f.get("type").and_then(J::as_str).unwrap_or("string").to_string(),
            computed,
            relation_many: f.get("relation").and_then(|x| x.get("cardinality")).and_then(J::as_str) == Some("many"),
            relation_table: f.get("relation").and_then(|x| x.get("table")).and_then(J::as_str).map(str::to_string),
            attachment: truthy(f.get("attachment")),
            required: truthy(get("required")),
            unique: truthy(get("unique")),
            choices: f.get("choices").and_then(J::as_array).map(|x| x.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default(),
            bounds: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].map(|k| get(k).cloned()),
            min_length,
            max_length,
            name,
        });
    }
    let mut keys: Vec<(Code, Vec<String>)> = Vec::new();
    if let Some(pk) = schema.get("primaryKey").and_then(J::as_array).filter(|k| !k.is_empty()) {
        keys.push((Code::KeyPrimary, pk.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()));
    }
    for k in schema.get("uniqueKeys").and_then(J::as_array).into_iter().flatten() {
        if let Some(k) = k.as_array().filter(|k| !k.is_empty()) {
            keys.push((Code::KeyUnique, k.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()));
        }
    }
    Ok(Some(Spec { fields, keys }))
}

/// The values met so far of each unique field and each key, with what stands for the row that held each first.
pub(crate) struct Seen {
    unique: Vec<HashMap<String, u32>>,
    keys: Vec<HashMap<String, u32>>,
}

impl Seen {
    fn new(spec: &Spec) -> Seen {
        Seen { unique: spec.fields.iter().map(|_| HashMap::new()).collect(), keys: spec.keys.iter().map(|_| HashMap::new()).collect() }
    }
}

/// A row's own problems, in problemsOf's order: its values', then a unique field's or a key's repeat
/// (`at` being what `first` gave for the row that held it first). Each is said to `out`.
fn row_found(spec: &Spec, r: &Rows, row: usize, seen: &mut Seen, first: &mut impl FnMut(usize) -> u32, out: &mut Vec<Found>) {
    let at = row as u32;
    let value = |field: &Field| js(r, row, r.cell_named(row, field.index, &field.name));
    for (i, field) in spec.fields.iter().enumerate() {
        if field.computed {
            continue;
        }
        value_problems(field, &value(field), &mut |code, item| out.push(Found { code, row: at, field: i as u32, at: item, key: NONE }));
    }
    for (i, field) in spec.fields.iter().enumerate() {
        if !field.unique || field.computed {
            continue;
        }
        let v = value(field);
        if view::is_empty(&v) {
            continue;
        }
        match seen.unique[i].entry(stringify(&v)) {
            std::collections::hash_map::Entry::Occupied(e) => out.push(Found { code: Code::Unique, row: at, field: i as u32, at: *e.get(), key: NONE }),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(first(row));
            }
        }
    }
    for (k, (code, names)) in spec.keys.iter().enumerate() {
        let values: Vec<Js> = names.iter().map(|n| js(r, row, r.cell_named(row, r.field(n), n))).collect();
        if *code == Code::KeyUnique && values.iter().any(view::is_empty) {
            continue;
        }
        // JSON.stringify(undefined) is undefined, which joins as "".
        let key = values.iter().map(|v: &Js| if matches!(v, Js::Undefined) { String::new() } else { stringify(v) }).collect::<Vec<_>>().join("\u{0}");
        match seen.keys[k].entry(key) {
            std::collections::hash_map::Entry::Occupied(e) => out.push(Found { code: *code, row: at, field: NONE, at: *e.get(), key: k as u32 }),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(first(row));
            }
        }
    }
}

/// Each text a choice field's value holds, as a choice no row has looks for it.
fn texts_held(v: Js, mut each: impl FnMut(&str)) {
    match v {
        Js::Str(s) => each(&s),
        Js::Json(raw) => {
            for x in view::items(raw).unwrap_or_default() {
                if let Js::Str(s) = x {
                    each(&s);
                }
            }
        }
        _ => {}
    }
}

/// A held table's problems, or None when it can't promise what memory gives.
pub fn problems(r: &Rows, input: &J, targets: &Targets) -> Result<Option<Problems>, String> {
    let schema = input.get("schema").ok_or("the input needs \"schema\"")?;
    let Some(spec) = spec(r, schema)? else { return Ok(None) };
    let bodies = strings(input.get("bodies"));
    let attachments = input.get("attachments").and_then(J::as_array).map(|x| x.iter().filter_map(|s| s.as_str().map(str::to_string)).collect::<Vec<_>>());

    let mut found = Vec::new();
    let fields = &spec.fields;
    let value = |row: usize, field: &Field| js(r, row, r.cell_named(row, field.index, &field.name));
    let mut seen = Seen::new(&spec);
    for row in 0..r.len() {
        row_found(&spec, r, row, &mut seen, &mut |row| row as u32, &mut found);
    }

    // A page whose row isn't there.
    for (i, id) in bodies.iter().enumerate() {
        if r.row_of(id).is_none() {
            found.push(Found { code: Code::BodyOrphaned, row: NONE, field: NONE, at: i as u32, key: NONE });
        }
    }

    for (i, field) in fields.iter().enumerate() {
        // A link to a row its table hasn't.
        if let Some(there) = field.relation_table.as_ref().and_then(|_| targets.get(&field.name)) {
            for row in 0..r.len() {
                let v = value(row, field);
                let ids: Vec<(u32, Js)> = match &v {
                    Js::Json(raw) => match view::items(raw) {
                        Some(xs) => xs.into_iter().enumerate().map(|(n, x)| (n as u32, x)).collect(),
                        None => vec![(NONE, v.clone())],
                    },
                    _ => vec![(NONE, v.clone())],
                };
                for (n, id) in ids {
                    if let Js::Str(s) = &id {
                        if !s.is_empty() && !there.contains(s.as_ref()) {
                            found.push(Found { code: Code::RelationDangling, row: row as u32, field: i as u32, at: n, key: NONE });
                        }
                    }
                }
            }
        }
        // A choice no row has.
        if !field.choices.is_empty() && !field.computed {
            let mut used: HashSet<String> = HashSet::new();
            for row in 0..r.len() {
                texts_held(value(row, field), |s| {
                    used.insert(s.to_string());
                });
            }
            for (c, choice) in field.choices.iter().enumerate() {
                if !used.contains(choice) {
                    found.push(Found { code: Code::ChoiceUnused, row: NONE, field: i as u32, at: c as u32, key: NONE });
                }
            }
        }
    }

    // A file in attachments/ no row's attachment field holds.
    let attachments = match attachments {
        Some(files) => {
            let mut held: HashSet<String> = HashSet::new();
            for field in fields.iter().filter(|f| f.attachment) {
                for row in 0..r.len() {
                    if let Js::Str(s) = value(row, field) {
                        held.insert(s.into_owned());
                    }
                }
            }
            for (i, file) in files.iter().enumerate() {
                if !held.contains(file) {
                    found.push(Found { code: Code::AttachmentOrphaned, row: NONE, field: NONE, at: i as u32, key: NONE });
                }
            }
            files
        }
        None => Vec::new(),
    };

    let counts = counted(&found);
    Ok(Some(Problems { spec, bodies, attachments, found, counts }))
}

/// How many of each kind, in the order each kind is first found.
fn counted(found: &[Found]) -> Vec<(&'static str, usize)> {
    let mut counts: Vec<(&'static str, usize)> = Vec::new();
    for f in found {
        match counts.iter_mut().find(|(c, _)| *c == f.code.name()) {
            Some(c) => c.1 += 1,
            None => counts.push((f.code.name(), 1)),
        }
    }
    counts
}

/// valueProblems, as codes: each found is said to `push` with its item's place in a list (NONE for none).
fn value_problems(field: &Field, v: &Js, push: &mut impl FnMut(Code, u32)) {
    if view::is_empty(v) {
        if field.required {
            push(Code::Required, NONE);
        }
        return;
    }
    if field.relation_many {
        let ok = matches!(v, Js::Json(raw) if view::items(raw).is_some_and(|xs| xs.iter().all(|x| matches!(x, Js::Str(_)))));
        if !ok {
            push(Code::Type, NONE);
        }
        return;
    }
    if !type_matches(&field.ty, v) {
        push(Code::Type, NONE);
        return;
    }
    if !field.choices.is_empty() {
        let items: Vec<(u32, Js)> = match v {
            Js::Json(raw) => match view::items(raw) {
                Some(xs) => xs.into_iter().enumerate().map(|(n, x)| (n as u32, x)).collect(),
                None => vec![(NONE, v.clone())],
            },
            _ => vec![(NONE, v.clone())],
        };
        for (n, item) in items {
            if !matches!(&item, Js::Str(s) if field.choices.iter().any(|c| c == s.as_ref())) {
                push(Code::Choice, n);
            }
        }
    }
    let codes = [Code::Minimum, Code::Maximum, Code::ExclusiveMinimum, Code::ExclusiveMaximum];
    for (i, code) in codes.into_iter().enumerate() {
        let Some(limit) = &field.bounds[i] else { continue };
        if let Some(order) = compare_bound(&field.ty, v, limit) {
            let fails = match code {
                Code::Minimum => order < 0.0,
                Code::Maximum => order > 0.0,
                Code::ExclusiveMinimum => order <= 0.0,
                _ => order >= 0.0,
            };
            if fails {
                push(code, NONE);
            }
        }
    }
    if let Js::Str(s) = v {
        let length = s.encode_utf16().count() as f64;
        if field.min_length.is_some_and(|n| length < n) {
            push(Code::MinLength, NONE);
        }
        if field.max_length.is_some_and(|n| length > n) {
            push(Code::MaxLength, NONE);
        }
    }
}

/// compareBound: negative below, 0 at, positive above; None when they can't be compared.
fn compare_bound(ty: &str, v: &Js, limit: &J) -> Option<f64> {
    match (v, limit) {
        (Js::Num(x), J::Number(l)) => Some(x - l.as_f64()?),
        (Js::Str(x), J::String(l)) => match ty {
            "date" | "time" | "yearmonth" => Some(match utf16_cmp(x, l) {
                std::cmp::Ordering::Less => -1.0,
                std::cmp::Ordering::Equal => 0.0,
                std::cmp::Ordering::Greater => 1.0,
            }),
            "datetime" => {
                let d = instant_of(x) - instant_of(l);
                (!d.is_nan()).then_some(d)
            }
            _ => None,
        },
        _ => None,
    }
}

/// A cell as a JSON value, for the checks that read one whole.
fn json_of(v: &Js) -> J {
    match v {
        Js::Undefined | Js::Null => J::Null,
        Js::Bool(b) => J::Bool(*b),
        Js::Num(n) => serde_json::Number::from_f64(*n).map_or(J::Null, J::Number),
        Js::Str(s) => J::String(s.to_string()),
        Js::Json(raw) => serde_json::from_slice(raw).unwrap_or(J::Null),
    }
}

/// typeMatches.
fn type_matches(ty: &str, v: &Js) -> bool {
    match ty {
        "string" => matches!(v, Js::Str(_)),
        "date" => matches!(v, Js::Str(s) if is_date(s)),
        "datetime" => matches!(v, Js::Str(s) if is_date_time(s)),
        "time" => matches!(v, Js::Str(s) if is_time(s)),
        "duration" => matches!(v, Js::Str(s) if is_duration(s)),
        "yearmonth" => matches!(v, Js::Str(s) if is_year_month(s)),
        "geojson" => is_geojson(&json_of(v)),
        "any" => !matches!(v, Js::Num(n) if !n.is_finite()),
        "number" => matches!(v, Js::Num(n) if n.is_finite()),
        "integer" | "year" => matches!(v, Js::Num(n) if n.is_finite() && n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0),
        "boolean" => matches!(v, Js::Bool(_)),
        "array" => matches!(v, Js::Json(raw) if raw.first() == Some(&b'[')),
        "object" => matches!(v, Js::Json(raw) if raw.first() == Some(&b'{')),
        "geopoint" => is_geopoint(&json_of(v)),
        _ => true,
    }
}

/// `typeof`, for a value that isn't empty.
fn type_of(v: &Js) -> &'static str {
    match v {
        Js::Str(_) => "string",
        Js::Num(_) => "number",
        Js::Bool(_) => "boolean",
        _ => "object",
    }
}

/// `JSON.stringify` of a cell, as JavaScript writes it.
fn stringify(v: &Js) -> String {
    let mut out = String::new();
    write_js(&mut out, &json_of(v));
    out
}

/// A string as `JSON.stringify` writes it.
fn js_quote(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Whether a key is an array index as JavaScript orders an object's keys: those come first, smallest first.
fn index_key(k: &str) -> Option<u32> {
    let n: u32 = k.parse().ok()?;
    (n != u32::MAX && n.to_string() == k).then_some(n)
}

/// A JSON value as `JSON.stringify` writes what `JSON.parse` made of it.
fn write_js(out: &mut String, v: &J) {
    match v {
        J::Null => out.push_str("null"),
        J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J::Number(n) => match n.as_f64() {
            Some(x) if x.is_finite() => out.push_str(&view::number_text(x)),
            _ => out.push_str("null"),
        },
        J::String(s) => js_quote(out, s),
        J::Array(xs) => {
            out.push('[');
            for (i, x) in xs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_js(out, x);
            }
            out.push(']');
        }
        J::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            // Array-index keys first, in number order; the rest as written.
            keys.sort_by_key(|k| index_key(k).map_or((1, 0), |n| (0, n)));
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                js_quote(out, k);
                out.push(':');
                write_js(out, &o[k]);
            }
            out.push('}');
        }
    }
}

impl Problems {
    /// Problems `from` up to `to`, as table-core's `Found`s, in JSON.
    pub fn window(&self, r: &Rows, from: usize, to: usize) -> String {
        let to = to.min(self.found.len());
        let mut out = String::from("[");
        for (n, f) in self.found[from.min(to)..to].iter().enumerate() {
            if n > 0 {
                out.push(',');
            }
            render(&mut out, f, &self.spec, &self.bodies, &self.attachments, Some(r), &|row| r.id(row as usize));
        }
        out.push(']');
        out
    }
}

/// A problem as table-core's `Found`, in JSON: its row's values read from `r` (the rows it's a
/// problem of, by its place there), and the row that holds a value first named by `other`.
fn render(out: &mut String, f: &Found, spec: &Spec, bodies: &[String], attachments: &[String], r: Option<&Rows>, other: &dyn Fn(u32) -> String) {
    out.push_str("{\"code\":\"");
    out.push_str(f.code.name());
    out.push('"');
    let field = (f.field != NONE).then(|| &spec.fields[f.field as usize]);
    let id = |row: u32| r.expect("a row's problem has its rows").id(row as usize);
    let text = |out: &mut String, k: &str, s: &str| {
        out.push_str(",\"");
        out.push_str(k);
        out.push_str("\":");
        json_string(out, s);
    };
    if f.row != NONE {
        text(out, "row", &id(f.row));
    } else if f.code == Code::BodyOrphaned {
        text(out, "row", &bodies[f.at as usize]);
    }
    if let Some(field) = field.filter(|_| !matches!(f.code, Code::KeyPrimary | Code::KeyUnique)) {
        text(out, "field", &field.name);
    }
    let mut details = String::from("{");
    let mut put = |k: &str, v: &str| {
        if details.len() > 1 {
            details.push(',');
        }
        json_string(&mut details, k);
        details.push(':');
        details.push_str(v);
    };
    let quoted = |s: &str| {
        let mut q = String::new();
        json_string(&mut q, s);
        q
    };
    let cell = |row: u32, field: &Field| {
        let r = r.expect("a value's problem has its rows");
        js(r, row as usize, r.cell_named(row as usize, field.index, &field.name))
    };
    let item = |row: u32, field: &Field, at: u32| -> Js<'static> {
        let v = cell(row, field);
        match (&v, at) {
            (Js::Json(raw), at) if at != NONE => view::items(raw).and_then(|xs| xs.into_iter().nth(at as usize)).unwrap_or(Js::Undefined),
            _ => match v {
                Js::Str(s) => Js::Str(std::borrow::Cow::Owned(s.into_owned())),
                Js::Num(n) => Js::Num(n),
                Js::Bool(b) => Js::Bool(b),
                Js::Null => Js::Null,
                Js::Undefined => Js::Undefined,
                Js::Json(raw) => view::items(raw).map_or(Js::Undefined, |_| Js::Undefined),
            },
        }
    };
    match f.code {
        Code::Required => {}
        Code::Type => {
            let field = field.expect("a value problem has its field");
            if field.relation_many {
                put("expected", "\"array\"");
            } else {
                put("expected", &quoted(&field.ty));
                put("got", &quoted(type_of(&cell(f.row, field))));
            }
        }
        Code::Choice => {
            let field = field.expect("a value problem has its field");
            let v = cell(f.row, field);
            let one = if f.at == NONE { stringify(&v) } else { stringify(&item(f.row, field, f.at)) };
            put("value", &quoted(&one));
        }
        Code::Minimum | Code::Maximum | Code::ExclusiveMinimum | Code::ExclusiveMaximum => {
            let field = field.expect("a value problem has its field");
            let (k, i) = match f.code {
                Code::Minimum => ("minimum", 0),
                Code::Maximum => ("maximum", 1),
                Code::ExclusiveMinimum => ("exclusiveMinimum", 2),
                _ => ("exclusiveMaximum", 3),
            };
            put("constraint", &quoted(k));
            put("limit", &serde_json::to_string(field.bounds[i].as_ref().unwrap_or(&J::Null)).unwrap_or_default());
        }
        Code::MinLength | Code::MaxLength => {
            let field = field.expect("a value problem has its field");
            let (k, limit) = if f.code == Code::MinLength { ("minLength", field.min_length) } else { ("maxLength", field.max_length) };
            put("constraint", &quoted(k));
            put("limit", &view::number_text(limit.unwrap_or(0.0)));
            let length = match cell(f.row, field) {
                Js::Str(s) => s.encode_utf16().count(),
                _ => 0,
            };
            put("length", &length.to_string());
        }
        Code::Unique => {
            let field = field.expect("a unique problem has its field");
            put("field", &quoted(&field.name));
            put("value", &quoted(&stringify(&cell(f.row, field))));
            put("other", &quoted(&other(f.at)));
        }
        Code::KeyPrimary | Code::KeyUnique => {
            put("fields", &quoted(&spec.keys[f.key as usize].1.join(",")));
            put("other", &quoted(&other(f.at)));
        }
        Code::BodyOrphaned => put("row", &quoted(&bodies[f.at as usize])),
        Code::RelationDangling => {
            let field = field.expect("a link has its field");
            put("field", &quoted(&field.name));
            put("table", &quoted(field.relation_table.as_deref().unwrap_or_default()));
            let target = match item(f.row, field, f.at) {
                Js::Str(s) => s.into_owned(),
                _ => String::new(),
            };
            put("value", &quoted(&target));
        }
        Code::ChoiceUnused => {
            let field = field.expect("a choice has its field");
            put("field", &quoted(&field.name));
            put("value", &quoted(&field.choices[f.at as usize]));
        }
        Code::AttachmentOrphaned => put("file", &quoted(&attachments[f.at as usize])),
    }
    details.push('}');
    out.push_str(",\"details\":");
    out.push_str(&details);
    if matches!(f.code, Code::Unique | Code::KeyPrimary | Code::KeyUnique) {
        text(out, "other", &other(f.at));
    }
    if matches!(f.code, Code::KeyPrimary | Code::KeyUnique) {
        out.push_str(&format!(",\"key\":{}", f.key));
    }
    out.push('}');
}

/// How many bytes of whole lines a check reads at a time.
const BATCH: usize = 4 << 20;

/// A problem said while its row was there to read: its `Found` in JSON, and its row's id and line
/// (what its fixes read), when it's a row's.
struct Said {
    json: String,
    /// Its row's id, line, and place among the table's rows (from 0).
    row: Option<(String, Box<[u8]>, usize)>,
    /// The row that holds its value or key first, by what `Seen` keeps for it.
    other: Option<u32>,
}

/// A table's problems found as its rows files are read, a few megabytes at a time (#867, step 2c): what
/// `problems` finds of the whole table, with only what's needed across its rows kept between files
/// (the values its unique fields and keys have met, which pages, choices and attachments a row
/// holds), and the first `window` problems said as they're found, with the rows they need.
///
/// No relation is checked: its target's rows are another table's, which an index build doesn't
/// read, as problemsOf doesn't check a relation to a table that isn't in memory.
pub struct Checker {
    names: Vec<String>,
    spec: Spec,
    bodies: Vec<String>,
    attachments: Option<Vec<String>>,
    window: usize,
    seen: Seen,
    /// The ids of the rows that held a unique value or a key first, by what `Seen` keeps for them.
    firsts: Vec<Box<str>>,
    /// Their places among the table's rows, from 0.
    first_places: Vec<u32>,
    rows: usize,
    said: Vec<Said>,
    row_found: usize,
    row_counts: Vec<(&'static str, usize)>,
    body_of: HashMap<String, usize>,
    body_held: Vec<bool>,
    /// Per field, its choices' places, and whether a row holds each.
    choices: Vec<(HashMap<String, usize>, Vec<bool>)>,
    attachment_of: HashMap<String, usize>,
    attachment_held: Vec<bool>,
    /// The file being read, as its pieces come, from the first line not yet checked.
    file: Vec<u8>,
    reading: String,
    lines_before: usize,
    batch: usize,
    found: Vec<Found>,
}

impl Checker {
    /// A check of a table with this schema (`schema`), its pages' ids (`bodies`), and the files of its
    /// `attachments/` when they're known; None when the engine can't promise what memory gives.
    pub fn new(input: &J) -> Result<Option<Checker>, String> {
        let schema = input.get("schema").ok_or("the input needs \"schema\"")?;
        let names: Vec<String> = schema.get("fields").and_then(J::as_array).ok_or("the schema needs \"fields\"")?.iter().map(|f| f.get("name").and_then(J::as_str).unwrap_or_default().to_string()).collect();
        let Some(spec) = spec(&Rows::new(&names), schema)? else { return Ok(None) };
        let bodies = strings(input.get("bodies"));
        let attachments = input.get("attachments").and_then(J::as_array).map(|x| x.iter().filter_map(|s| s.as_str().map(str::to_string)).collect::<Vec<_>>());
        let window = input.get("window").and_then(J::as_u64).unwrap_or(200) as usize;
        let choices = spec
            .fields
            .iter()
            .map(|f| if f.choices.is_empty() || f.computed { (HashMap::new(), Vec::new()) } else { (places(&f.choices), vec![false; f.choices.len()]) })
            .collect();
        let attachment_of = places(attachments.as_deref().unwrap_or_default());
        Ok(Some(Checker {
            seen: Seen::new(&spec),
            body_of: places(&bodies),
            body_held: vec![false; bodies.len()],
            attachment_held: vec![false; attachments.as_ref().map_or(0, Vec::len)],
            attachment_of,
            choices,
            names,
            spec,
            bodies,
            attachments,
            window,
            firsts: Vec::new(),
            first_places: Vec::new(),
            rows: 0,
            said: Vec::new(),
            row_found: 0,
            row_counts: Vec::new(),
            file: Vec::new(),
            reading: String::new(),
            lines_before: 0,
            batch: input.get("batch").and_then(J::as_u64).map_or(BATCH, |b| b.max(1) as usize),
            found: Vec::new(),
        }))
    }

    /// A rows file begins (`name`, for saying where a line is).
    pub fn begin_file(&mut self, name: &str) {
        self.file.clear();
        name.clone_into(&mut self.reading);
        self.lines_before = 0;
    }

    /// A piece of the rows file being read. Its rows are checked a few megabytes at a time, as whole
    /// lines come, and let go: what a check holds of them is never more than that, however large
    /// the file.
    pub fn piece(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.file.try_reserve(bytes.len()).map_err(|_| format!("{}: a line past {} bytes can't be held to check", self.reading, self.file.len()))?;
        self.file.extend_from_slice(bytes);
        if self.file.len() >= self.batch {
            if let Some(end) = self.file.iter().rposition(|&b| b == b'\n') {
                // The lines checked, and the start of the next kept in the same bytes: held once, not made again each time.
                let rest = self.file[end + 1..].to_vec();
                let mut lines = std::mem::take(&mut self.file);
                lines.truncate(end + 1);
                let mut bytes = self.check_lines(lines)?;
                bytes.clear();
                bytes.extend_from_slice(&rest);
                self.file = bytes;
            }
        }
        Ok(())
    }

    /// The rows file being read has ended: the rest of its rows are checked. A line the engine
    /// doesn't read as a row is an error: the check couldn't promise memory's answer without it.
    pub fn end_file(&mut self, name: &str) -> Result<usize, String> {
        if self.reading.is_empty() {
            name.clone_into(&mut self.reading);
        }
        let lines = std::mem::take(&mut self.file);
        self.file = self.check_lines(lines)?;
        self.file.clear();
        self.reading.clear();
        Ok(self.rows)
    }

    /// Whole lines of the file being read, checked; their bytes given back, for the next.
    fn check_lines(&mut self, lines: Vec<u8>) -> Result<Vec<u8>, String> {
        if lines.is_empty() {
            return Ok(lines);
        }
        let count = lines.iter().filter(|&&b| b == b'\n').count();
        let mut r = Rows::new(&self.names);
        // A byte order mark is the file's, at its start.
        r.read(&self.reading, lines, self.lines_before == 0)?;
        if let Some(l) = r.lines().first() {
            let why = match l.is {
                crate::rows::LineIs::NotJson => "isn't JSON the engine reads",
                crate::rows::LineIs::NotRow => "isn't a row",
                crate::rows::LineIs::NoId => "has no id",
                crate::rows::LineIs::Repeat(_) => "repeats a row's id",
            };
            return Err(format!("{}: line {} {why}", self.reading, self.lines_before + l.line as usize + 1));
        }
        self.lines_before += count;
        let Checker { spec, seen, firsts, first_places, said, found, window, row_counts, row_found: count, body_of, body_held, choices, attachment_of, attachment_held, bodies, attachments, rows: before, .. } = self;
        let before = *before;
        let attachment_fields: Vec<&Field> = spec.fields.iter().filter(|f| f.attachment).collect();
        for row in 0..r.len() {
            found.clear();
            row_found(spec, &r, row, seen, &mut |row| {
                firsts.push(r.id(row).into());
                first_places.push((before + row) as u32);
                (firsts.len() - 1) as u32
            }, found);
            for f in found.iter() {
                *count += 1;
                match row_counts.iter_mut().find(|(c, _)| *c == f.code.name()) {
                    Some(c) => c.1 += 1,
                    None => row_counts.push((f.code.name(), 1)),
                }
                if said.len() < *window {
                    let mut json = String::new();
                    render(&mut json, f, spec, bodies, attachments.as_deref().unwrap_or_default(), Some(&r), &|at| firsts[at as usize].to_string());
                    let other = matches!(f.code, Code::Unique | Code::KeyPrimary | Code::KeyUnique).then_some(f.at);
                    said.push(Said { json, row: Some((r.id(row), r.line(row).into(), before + row)), other });
                }
            }
            if !body_of.is_empty() {
                if let Some(&i) = body_of.get(&r.id(row)) {
                    body_held[i] = true;
                }
            }
            for (field, (of, held)) in spec.fields.iter().zip(choices.iter_mut()) {
                if !held.is_empty() {
                    texts_held(js(&r, row, r.cell_named(row, field.index, &field.name)), |s| {
                        if let Some(&i) = of.get(s) {
                            held[i] = true;
                        }
                    });
                }
            }
            if !attachment_of.is_empty() {
                for field in &attachment_fields {
                    if let Js::Str(s) = js(&r, row, r.cell_named(row, field.index, &field.name)) {
                        if let Some(&i) = attachment_of.get(s.as_ref()) {
                            attachment_held[i] = true;
                        }
                    }
                }
            }
        }
        self.rows += r.len();
        Ok(r.into_bytes().pop().unwrap_or_default())
    }

    /// The table's problems, in problemsOf's order: how many there are, of each kind, the first
    /// `window` of them, and the rows those are problems of, as their lines.
    pub fn finish(self) -> String {
        let mut rest: Vec<Found> = Vec::new();
        // A name listed twice is held, or not, as its first is.
        let held_at = |of: &HashMap<String, usize>, held: &[bool], name: &str| of.get(name).is_some_and(|&i| held[i]);
        for (i, id) in self.bodies.iter().enumerate() {
            if !held_at(&self.body_of, &self.body_held, id) {
                rest.push(Found { code: Code::BodyOrphaned, row: NONE, field: NONE, at: i as u32, key: NONE });
            }
        }
        for (i, (of, held)) in self.choices.iter().enumerate() {
            for (c, choice) in self.spec.fields[i].choices.iter().enumerate().take(held.len()) {
                if !held_at(of, held, choice) {
                    rest.push(Found { code: Code::ChoiceUnused, row: NONE, field: i as u32, at: c as u32, key: NONE });
                }
            }
        }
        for (i, file) in self.attachments.iter().flatten().enumerate() {
            if !held_at(&self.attachment_of, &self.attachment_held, file) {
                rest.push(Found { code: Code::AttachmentOrphaned, row: NONE, field: NONE, at: i as u32, key: NONE });
            }
        }
        let mut counts = self.row_counts.clone();
        for (code, n) in counted(&rest) {
            match counts.iter_mut().find(|(c, _)| *c == code) {
                Some(c) => c.1 += n,
                None => counts.push((code, n)),
            }
        }
        let mut out = format!("{{\"rules\":{RULES},\"rows\":{},\"total\":{},\"counts\":{{", self.rows, self.row_found + rest.len());
        for (i, (code, n)) in counts.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            out.push_str(&format!("\"{code}\":{n}"));
        }
        out.push_str("},\"found\":[");
        let attachments = self.attachments.as_deref().unwrap_or_default();
        let mut n = 0;
        for s in &self.said {
            if n > 0 {
                out.push(',');
            }
            out.push_str(&s.json);
            n += 1;
        }
        for f in rest.iter().take(self.window.saturating_sub(n)) {
            if n > 0 {
                out.push(',');
            }
            render(&mut out, f, &self.spec, &self.bodies, attachments, None, &|_| String::new());
            n += 1;
        }
        // The rows the problems said are of, once each: their fixes read their values.
        out.push_str("],\"lines\":[");
        let mut lines: Vec<&str> = Vec::new();
        for (id, line, _) in self.said.iter().filter_map(|s| s.row.as_ref()) {
            if !lines.contains(&id.as_str()) {
                if !lines.is_empty() {
                    out.push(',');
                }
                lines.push(id);
                json_string(&mut out, &String::from_utf8_lossy(line));
            }
        }
        // Where each row the problems name is among the table's rows, from 0, by id: for saying "row 8".
        out.push_str("],\"at\":{");
        let mut named: Vec<(&str, usize)> = Vec::new();
        for s in &self.said {
            if let Some((id, _, at)) = &s.row {
                named.push((id, *at));
            }
            if let Some(o) = s.other {
                named.push((&self.firsts[o as usize], self.first_places[o as usize] as usize));
            }
        }
        let mut written: Vec<&str> = Vec::new();
        for (id, at) in named {
            if !written.contains(&id) {
                if !written.is_empty() {
                    out.push(',');
                }
                json_string(&mut out, id);
                out.push(':');
                out.push_str(&at.to_string());
                written.push(id);
            }
        }
        out.push_str("}}");
        out
    }
}

/// Each name's first place in a list.
fn places(names: &[String]) -> HashMap<String, usize> {
    let mut of = HashMap::new();
    for (i, n) in names.iter().enumerate() {
        of.entry(n.clone()).or_insert(i);
    }
    of
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stringify_is_javascripts() {
        let mut out = String::new();
        write_js(&mut out, &serde_json::from_str::<J>(r#"{"b":1,"2":true,"a":[1.50,-0,"x\ny\u0001 "],"1":null,"01":2}"#).unwrap());
        assert_eq!(out, "{\"1\":null,\"2\":true,\"b\":1,\"a\":[1.5,0,\"x\\ny\\u0001\u{2028}\"],\"01\":2}");
    }

    #[test]
    fn a_check_file_by_file_finds_what_the_whole_table_has() {
        let input: J = serde_json::from_str(r#"{"schema":{"fields":[{"name":"n","type":"number","constraints":{"unique":true,"maximum":5}},{"name":"s","type":"string","choices":["a","b","c","a"]}],"primaryKey":["s"]},"bodies":["x","gone"],"attachments":[],"window":3}"#).unwrap();
        let files = ["{\"id\":\"x\",\"n\":1,\"s\":\"a\"}\n{\"id\":\"y\",\"n\":9}\n", "{\"id\":\"z\",\"n\":1,\"s\":\"a\"}\n\n"];
        // Checked in batches of whole lines, of every size: a line is never cut.
        let mut answers = Vec::new();
        for batch in [1, 7, 30, 4 << 20] {
            let mut input = input.clone();
            input["batch"] = batch.into();
            let mut c = Checker::new(&input).unwrap().unwrap();
            for (i, f) in files.iter().enumerate() {
                c.begin_file(&format!("rows/000{i}.ndjson"));
                for piece in f.as_bytes().chunks(5) {
                    c.piece(piece).unwrap();
                }
                assert!(c.end_file(&format!("rows/000{i}.ndjson")).is_ok());
            }
            answers.push(c.finish());
        }
        assert!(answers.iter().all(|a| *a == answers[0]));
        let got: J = serde_json::from_str(&answers[0]).unwrap();
        // The whole table read at once, by `problems`.
        let mut r = Rows::new(&["n".into(), "s".into()]);
        r.read("rows", files.concat().into_bytes(), true).unwrap();
        let p = problems(&r, &input, &Targets::new()).unwrap().unwrap();
        let want: J = serde_json::from_str(&p.window(&r, 0, 3)).unwrap();
        assert_eq!(got["found"], want);
        assert_eq!(got["total"], p.found.len());
        assert_eq!(got["rows"], 3);
        assert_eq!(got["rules"], RULES);
        // Rows z repeats x's n and its key, and y is over its maximum: their lines, once each.
        assert_eq!(got["lines"], serde_json::json!(["{\"id\":\"y\",\"n\":9}", "{\"id\":\"z\",\"n\":1,\"s\":\"a\"}"]));
        // y is the table's second row and z its third, across the files; x (the first) holds what z repeats.
        assert_eq!(got["at"], serde_json::json!({"y": 1, "z": 2, "x": 0}));
        let counts: Vec<(&str, usize)> = got["counts"].as_object().unwrap().iter().map(|(k, v)| (k.as_str(), v.as_u64().unwrap() as usize)).collect();
        assert_eq!(counts.iter().map(|c| c.1).sum::<usize>(), p.found.len());
    }

    #[test]
    fn a_line_the_engine_cant_read_ends_the_check_with_why() {
        let mut c = Checker::new(&serde_json::from_str(r#"{"schema":{"fields":[]},"batch":10}"#).unwrap()).unwrap().unwrap();
        c.begin_file("rows/0001.ndjson");
        // A key that's a lone surrogate, on line 4, in the second batch: JavaScript's JSON.parse reads it, and the engine doesn't.
        let err = c.piece(b"{\"id\":\"a\"}\n\n{\"id\":\"b\"}\n{\"id\":\"c\",\"\\ud800\":1}\n{\"id\":\"d\"}").and_then(|()| c.end_file("rows/0001.ndjson").map(|_| ())).unwrap_err();
        assert_eq!(err, "rows/0001.ndjson: line 4 isn't JSON the engine reads");
        // A pattern isn't checked at all.
        assert!(Checker::new(&serde_json::from_str(r#"{"schema":{"fields":[{"name":"s","constraints":{"pattern":"x"}}]}}"#).unwrap()).unwrap().is_none());
    }

}
