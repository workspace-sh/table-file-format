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

/// The problems asked for, and everything needed to say a window of them.
pub struct Problems {
    fields: Vec<Field>,
    keys: Vec<(Code, Vec<String>)>,
    bodies: Vec<String>,
    attachments: Vec<String>,
    pub found: Vec<Found>,
    pub counts: Vec<(&'static str, usize)>,
}

/// What a relation's target holds: its rows' ids, when it's in the bundle and its rows can be read.
pub type Targets = HashMap<String, HashSet<String>>;

/// A held table's problems, or None when it can't promise what memory gives.
pub fn problems(r: &Rows, input: &J, targets: &Targets) -> Result<Option<Problems>, String> {
    let schema = input.get("schema").ok_or("the input needs \"schema\"")?;
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
    let strings = |v: Option<&J>| -> Vec<String> { v.and_then(J::as_array).map(|x| x.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default() };
    let mut keys: Vec<(Code, Vec<String>)> = Vec::new();
    if let Some(pk) = schema.get("primaryKey").and_then(J::as_array).filter(|k| !k.is_empty()) {
        keys.push((Code::KeyPrimary, pk.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()));
    }
    for k in schema.get("uniqueKeys").and_then(J::as_array).into_iter().flatten() {
        if let Some(k) = k.as_array().filter(|k| !k.is_empty()) {
            keys.push((Code::KeyUnique, k.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()));
        }
    }
    let bodies = strings(input.get("bodies"));
    let attachments = input.get("attachments").and_then(J::as_array).map(|x| x.iter().filter_map(|s| s.as_str().map(str::to_string)).collect::<Vec<_>>());

    let mut found = Vec::new();
    let value = |row: usize, field: &Field| js(r, row, r.cell_named(row, field.index, &field.name));
    let mut unique_seen: Vec<HashMap<String, u32>> = fields.iter().map(|_| HashMap::new()).collect();
    let mut key_seen: Vec<HashMap<String, u32>> = keys.iter().map(|_| HashMap::new()).collect();
    for row in 0..r.len() {
        let at = row as u32;
        for (i, field) in fields.iter().enumerate() {
            if field.computed {
                continue;
            }
            value_problems(field, &value(row, field), &mut |code, item| found.push(Found { code, row: at, field: i as u32, at: item, key: NONE }));
        }
        for (i, field) in fields.iter().enumerate() {
            if !field.unique || field.computed {
                continue;
            }
            let v = value(row, field);
            if view::is_empty(&v) {
                continue;
            }
            match unique_seen[i].entry(stringify(&v)) {
                std::collections::hash_map::Entry::Occupied(first) => found.push(Found { code: Code::Unique, row: at, field: i as u32, at: *first.get(), key: NONE }),
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(at);
                }
            }
        }
        for (k, (code, names)) in keys.iter().enumerate() {
            let values: Vec<Js> = names.iter().map(|n| js(r, row, r.cell_named(row, r.field(n), n))).collect();
            if *code == Code::KeyUnique && values.iter().any(view::is_empty) {
                continue;
            }
            // JSON.stringify(undefined) is undefined, which joins as "".
            let key = values.iter().map(|v: &Js| if matches!(v, Js::Undefined) { String::new() } else { stringify(v) }).collect::<Vec<_>>().join("\u{0}");
            match key_seen[k].entry(key) {
                std::collections::hash_map::Entry::Occupied(first) => found.push(Found { code: *code, row: at, field: NONE, at: *first.get(), key: k as u32 }),
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(at);
                }
            }
        }
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
                match value(row, field) {
                    Js::Str(s) => {
                        used.insert(s.into_owned());
                    }
                    Js::Json(raw) => {
                        for x in view::items(raw).unwrap_or_default() {
                            if let Js::Str(s) = x {
                                used.insert(s.into_owned());
                            }
                        }
                    }
                    _ => {}
                }
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

    let mut counts: Vec<(&'static str, usize)> = Vec::new();
    for f in &found {
        match counts.iter_mut().find(|(c, _)| *c == f.code.name()) {
            Some(c) => c.1 += 1,
            None => counts.push((f.code.name(), 1)),
        }
    }
    Ok(Some(Problems { fields, keys, bodies, attachments, found, counts }))
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
            out.push_str("{\"code\":\"");
            out.push_str(f.code.name());
            out.push('"');
            let field = (f.field != NONE).then(|| &self.fields[f.field as usize]);
            let id = |row: u32| r.id(row as usize);
            let text = |out: &mut String, k: &str, s: &str| {
                out.push_str(",\"");
                out.push_str(k);
                out.push_str("\":");
                json_string(out, s);
            };
            if f.row != NONE {
                text(&mut out, "row", &id(f.row));
            } else if f.code == Code::BodyOrphaned {
                text(&mut out, "row", &self.bodies[f.at as usize]);
            }
            if let Some(field) = field.filter(|_| !matches!(f.code, Code::KeyPrimary | Code::KeyUnique)) {
                text(&mut out, "field", &field.name);
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
            let cell = |row: u32, field: &Field| js(r, row as usize, r.cell_named(row as usize, field.index, &field.name));
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
                    put("other", &quoted(&id(f.at)));
                }
                Code::KeyPrimary | Code::KeyUnique => {
                    put("fields", &quoted(&self.keys[f.key as usize].1.join(",")));
                    put("other", &quoted(&id(f.at)));
                }
                Code::BodyOrphaned => put("row", &quoted(&self.bodies[f.at as usize])),
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
                Code::AttachmentOrphaned => put("file", &quoted(&self.attachments[f.at as usize])),
            }
            details.push('}');
            out.push_str(",\"details\":");
            out.push_str(&details);
            if matches!(f.code, Code::Unique | Code::KeyPrimary | Code::KeyUnique) {
                text(&mut out, "other", &id(f.at));
            }
            if matches!(f.code, Code::KeyPrimary | Code::KeyUnique) {
                out.push_str(&format!(",\"key\":{}", f.key));
            }
            out.push('}');
        }
        out.push(']');
        out
    }
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
}
