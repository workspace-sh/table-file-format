//! Edits to a held table (table-file-format#867, step 3a): `rows.apply` takes changes in the
//! format table-core's `changes.ts` defines and applies them as its `applyChanges` does, the
//! merge rule included: a change never refuses, a delete of a row since changed leaves it, an
//! edit to a row deleted brings it back, an insert whose neighbour has gone goes at the end.
//!
//! The rows are the engine's; a row's page and its cells' own formulas are the caller's. The
//! caller gives the pages and cells of the rows the changes name, and is told, in the order
//! `applyChanges` makes them, what to do to its own (`effects`). The answer says too which rows
//! changed and the edits as history says them (`edit-log.ts`'s events, as `rowsChanges` makes
//! them): the inverse a later undo applies.
//!
//! A row an edit writes is a new line, made from the row as read: every value nobody changed
//! keeps its bytes as read, and a row edited back to how it was read is its line as read again.
//! A batch the engine can't take (an operation that isn't a row's, a value it can't read, no
//! memory) changes nothing.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value as J};

use crate::rows::Rows;

/// One change, as `BundleChange` says it. `None` where the change has no `to`: empty.
enum Change {
    Set { row: String, field: String, to: Option<J> },
    Insert { row: String, values: Map<String, J>, after: After, page: Option<J>, cells: Vec<J> },
    Delete { row: String, values: Map<String, J>, page: Option<J>, cells: Vec<J> },
    Move { row: String, after: After },
    Page { row: String, to: Option<J> },
    Cell { row: String, field: String, to: Option<J> },
}

impl Change {
    fn row(&self) -> &str {
        match self {
            Change::Set { row, .. } | Change::Insert { row, .. } | Change::Delete { row, .. } | Change::Move { row, .. } | Change::Page { row, .. } | Change::Cell { row, .. } => row,
        }
    }
}

/// Where a row goes: `after` null is the start; a row's id, after it, or the end once it has
/// gone; and none at all, the end (as `placeAfter` finds no row whose id is undefined).
enum After {
    Start,
    Row(String),
    End,
}

/// The operations of `BundleChange` that aren't a row's: they stay with the caller.
const NOT_ROWS: &[&str] = &["field", "field-order", "schema", "view", "view-order", "meta", "table-add", "table-remove"];

fn text(c: &J, k: &str) -> Result<String, String> {
    c.get(k).and_then(J::as_str).map(str::to_string).ok_or_else(|| format!("a change needs \"{k}\", as text"))
}

fn after_of(c: &J) -> Result<After, String> {
    match c.get("after") {
        None => Ok(After::End),
        Some(J::Null) => Ok(After::Start),
        Some(J::String(s)) => Ok(After::Row(s.clone())),
        Some(_) => Err("a change's \"after\" is a row's id or null".into()),
    }
}

fn values_of(c: &J, row: &str) -> Result<Map<String, J>, String> {
    let values = c.get("values").and_then(J::as_object).ok_or("an insert or a delete needs \"values\", the row")?;
    if values.get("id").and_then(J::as_str) != Some(row) {
        return Err(format!("the row \"{row}\" is given with another id"));
    }
    Ok(values.clone())
}

fn cells_of(c: &J) -> Vec<J> {
    c.get("cells").and_then(J::as_array).cloned().unwrap_or_default()
}

fn parse(changes: &[J]) -> Result<Vec<Change>, String> {
    changes
        .iter()
        .map(|c| {
            let op = c.get("op").and_then(J::as_str).ok_or("a change needs \"op\"")?;
            if NOT_ROWS.contains(&op) {
                return Err(format!("a \"{op}\" change isn't a row's: the table's schema, views and meta are changed where they're held"));
            }
            let row = text(c, "row")?;
            Ok(match op {
                "set" => {
                    let field = text(c, "field")?;
                    if field == "id" {
                        return Err("a row's id isn't changed by a set: remove the row and insert it".into());
                    }
                    Change::Set { row, field, to: c.get("to").cloned() }
                }
                "insert" => Change::Insert { values: values_of(c, &row)?, after: after_of(c)?, page: c.get("page").cloned(), cells: cells_of(c), row },
                "delete" => Change::Delete { values: values_of(c, &row)?, page: c.get("page").cloned(), cells: cells_of(c), row },
                "move" => Change::Move { after: after_of(c)?, row },
                "page" => Change::Page { row, to: c.get("to").cloned() },
                "cell" => Change::Cell { field: text(c, "field")?, to: c.get("to").cloned(), row },
                _ => return Err(format!("{op:?} isn't a change the engine knows")),
            })
        })
        .collect()
}

// --- Values as JavaScript has them -------------------------------------------------------------

/// A key JavaScript keeps first, in number order: an array index.
fn index_key(k: &str) -> Option<u32> {
    if k == "0" {
        return Some(0);
    }
    if k.is_empty() || k.len() > 10 || k.starts_with('0') || !k.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    k.parse::<u64>().ok().filter(|&n| n < u64::from(u32::MAX)).map(|n| n as u32)
}

/// An object's keys in the order JavaScript gives them: array indexes first, in number order,
/// then the rest as written.
fn js_keys(m: &Map<String, J>) -> Vec<&String> {
    let mut indexes: Vec<(u32, &String)> = m.keys().filter_map(|k| index_key(k).map(|n| (n, k))).collect();
    indexes.sort_unstable();
    indexes.into_iter().map(|(_, k)| k).chain(m.keys().filter(|k| index_key(k).is_none())).collect()
}

fn js_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn js_number(out: &mut String, n: &serde_json::Number) {
    match n.as_f64() {
        Some(x) if x.is_finite() => out.push_str(ryu_js::Buffer::new().format(x)),
        _ => out.push_str("null"),
    }
}

/// A value as `JSON.stringify` writes it; `sorted`, with every object's keys sorted, as
/// `changes.ts`'s `canonical` writes it.
fn js_json(out: &mut String, v: &J, sorted: bool) {
    match v {
        J::Null => out.push_str("null"),
        J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J::Number(n) => js_number(out, n),
        J::String(s) => js_string(out, s),
        J::Array(xs) => {
            out.push('[');
            for (i, x) in xs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                js_json(out, x, sorted);
            }
            out.push(']');
        }
        J::Object(m) => {
            out.push('{');
            let mut keys = js_keys(m);
            if sorted {
                // Array.prototype.sort on keys: by UTF-16 code units.
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            }
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                js_string(out, k);
                out.push(':');
                js_json(out, &m[k], sorted);
            }
            out.push('}');
        }
    }
}

fn written(v: &J, sorted: bool) -> String {
    let mut out = String::new();
    js_json(&mut out, v, sorted);
    out
}

/// Empty, as SPEC section 3 says: absent, null or "".
fn empty(v: Option<&J>) -> bool {
    matches!(v, None | Some(J::Null)) || v.and_then(J::as_str) == Some("")
}

/// `changes.ts`'s `same`: both empty, or written the same with their keys sorted.
fn same(a: Option<&J>, b: Option<&J>) -> bool {
    (empty(a) && empty(b)) || a.map(|v| written(v, true)) == b.map(|v| written(v, true))
}

/// `edit-log.ts`'s `same`: both empty, the same value, or lists and objects written the same.
fn same_stored(a: Option<&J>, b: Option<&J>) -> bool {
    if empty(a) && empty(b) {
        return true;
    }
    match (a, b) {
        (Some(J::Number(x)), Some(J::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(J::String(x)), Some(J::String(y))) => x == y,
        (Some(J::Bool(x)), Some(J::Bool(y))) => x == y,
        (Some(x @ (J::Array(_) | J::Object(_) | J::Null)), Some(y @ (J::Array(_) | J::Object(_) | J::Null))) => written(x, false) == written(y, false),
        _ => false,
    }
}

/// A row as its rows file holds it: without the fields worked out from others.
fn stored(row: &Map<String, J>, computed: &HashSet<String>) -> Map<String, J> {
    let mut out = row.clone();
    out.retain(|k, _| !computed.contains(k));
    out
}

// --- A row's line, written from the row as read --------------------------------------------------

/// A key and its value in a line: where the key starts, and where its value starts and ends.
struct Entry {
    key: String,
    start: usize,
    value: (usize, usize),
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && matches!(b[i], b' ' | b'\t' | b'\n' | b'\r') {
        i += 1;
    }
    i
}

/// A row's line as its entries, and where its closing brace is. None when it isn't an object
/// JSON reads with no more than JSON's own white space (a line that has more is written whole).
fn entries(b: &[u8]) -> Option<(Vec<Entry>, usize)> {
    let mut i = skip_ws(b, 0);
    if b.get(i) != Some(&b'{') {
        return None;
    }
    i = skip_ws(b, i + 1);
    let mut out = Vec::new();
    if b.get(i) == Some(&b'}') {
        return Some((out, i));
    }
    loop {
        let start = i;
        if b.get(i) != Some(&b'"') {
            return None;
        }
        let mut j = i + 1;
        while j < b.len() && b[j] != b'"' {
            j += if b[j] == b'\\' { 2 } else { 1 };
        }
        let key: String = serde_json::from_slice(b.get(i..=j)?).ok()?;
        i = skip_ws(b, j + 1);
        if b.get(i) != Some(&b':') {
            return None;
        }
        i = skip_ws(b, i + 1);
        let mut values = serde_json::Deserializer::from_slice(&b[i..]).into_iter::<serde::de::IgnoredAny>();
        values.next()?.ok()?;
        let end = i + values.byte_offset();
        out.push(Entry { key, start, value: (i, end) });
        i = skip_ws(b, end);
        match b.get(i) {
            Some(b',') => i = skip_ws(b, i + 1),
            Some(b'}') => return Some((out, i)),
            _ => return None,
        }
    }
}

/// The line of a row with the values `target`, written from `origin` (the row as read, or as
/// inserted): a value that's what the origin holds keeps its bytes, and its place; a value
/// changed is written in its place; a key gone is taken out; a key new is put at the end.
fn render(origin: &[u8], target: &Map<String, J>) -> Vec<u8> {
    let Some((list, close)) = entries(origin) else { return written(&J::Object(target.clone()), false).into_bytes() };
    // The last of a key written twice is its value, as JSON.parse reads it.
    let last: HashMap<&str, usize> = list.iter().enumerate().map(|(i, e)| (e.key.as_str(), i)).collect();
    let unchanged = |i: usize| -> bool {
        let e = &list[i];
        let Some(want) = target.get(&e.key) else { return false };
        serde_json::from_slice::<J>(&origin[e.value.0..e.value.1]).is_ok_and(|was| written(&was, true) == written(want, true))
    };
    let keep_all: Vec<bool> = (0..list.len()).map(|i| last[list[i].key.as_str()] == i && unchanged(i)).collect();
    // A key whose value stands keeps every time it's written; one changed or gone, none but its last.
    let stands: HashSet<&str> = list.iter().enumerate().filter(|(i, _)| keep_all[*i]).map(|(_, e)| e.key.as_str()).collect();
    let mut out: Vec<u8> = Vec::with_capacity(origin.len() + 16);
    let prefix_end = list.first().map_or(close, |e| e.start);
    out.extend_from_slice(&origin[..prefix_end]);
    let mut any = false;
    let mut previous_end = prefix_end;
    for (i, e) in list.iter().enumerate() {
        let separator = &origin[previous_end..e.start];
        previous_end = e.value.1;
        let key = e.key.as_str();
        let write: Option<Vec<u8>> = if stands.contains(key) {
            Some(origin[e.start..e.value.1].to_vec())
        } else if last[key] == i {
            target.get(key).map(|v| {
                let mut entry = origin[e.start..e.value.0].to_vec();
                entry.extend_from_slice(written(v, false).as_bytes());
                entry
            })
        } else {
            None
        };
        if let Some(entry) = write {
            if any {
                // Its own separator, unless that was the first's (none): then a comma.
                if i > 0 { out.extend_from_slice(separator) } else { out.push(b',') }
            }
            out.extend_from_slice(&entry);
            any = true;
        }
    }
    let had: HashSet<&str> = list.iter().map(|e| e.key.as_str()).collect();
    for k in js_keys(target) {
        if had.contains(k.as_str()) {
            continue;
        }
        if any {
            out.push(b',');
        }
        let mut entry = String::new();
        js_string(&mut entry, k);
        entry.push(':');
        js_json(&mut entry, &target[k], false);
        out.extend_from_slice(entry.as_bytes());
        any = true;
    }
    let tail_from = list.last().map_or(close, |e| e.value.1);
    out.extend_from_slice(&origin[tail_from..]);
    out
}

// --- Applying ------------------------------------------------------------------------------------

/// What `rows.apply` tells its caller to do to its pages and cells, in order.
enum Effect {
    /// A row's page set, or (None) taken away.
    Page(String, Option<J>),
    /// A row's cells' formulas taken away: one field's, or (None) all of them.
    Drop(String, Option<String>),
    /// Cells' formulas added at the end.
    Add(Vec<J>),
}

/// A row an edit has taken out, which a later change of the batch can bring back.
struct Removed {
    slot: usize,
    page: Option<J>,
    cells: Vec<J>,
}

struct Batch<'r> {
    rows: &'r mut Rows,
    pages: HashMap<String, Option<J>>,
    cells: HashMap<String, Vec<J>>,
    removed: HashMap<String, Removed>,
    effects: Vec<Effect>,
    /// The row this batch put in last and its place, while nothing since has moved a row: a paste
    /// puts each row after the one before it, found here without looking.
    last_put: Option<(String, usize)>,
    /// Rows put in one after another, not yet in the order: where, and their slots. Put in together
    /// before anything else looks at places (`flush`).
    pending: Option<(usize, Vec<usize>)>,
}

/// Whether a slot's row holds exactly these values, written the same (keys in any order).
fn values_same(rows: &Rows, slot: usize, values: &Map<String, J>) -> bool {
    serde_json::from_slice::<J>(rows.slot_line(slot)).is_ok_and(|v| written(&v, true) == written(&J::Object(values.clone()), true))
}

/// A row's values, parsed from its line.
fn values(rows: &Rows, slot: usize) -> Result<Map<String, J>, String> {
    match serde_json::from_slice::<J>(rows.slot_line(slot)) {
        Ok(J::Object(m)) => Ok(m),
        _ => Err(format!("the row \"{}\" holds a value the engine can't read back (a number past what JavaScript holds)", rows.slot_id(slot))),
    }
}

impl Batch<'_> {
    fn place(&mut self, id: &str) -> Option<usize> {
        let slot = self.rows.slot_of(id)?;
        self.rows.place_of(slot)
    }

    /// Where a row goes after `after`: the start when it's null, the end when it has gone.
    fn after(&mut self, after: &After) -> usize {
        match after {
            After::Start => 0,
            After::End => self.rows.len(),
            After::Row(a) => match &self.last_put {
                Some((id, place)) if id == a => place + 1,
                _ => self.place(a).map_or(self.rows.len(), |p| p + 1),
            },
        }
    }

    /// The rows put in one after another, into the order together.
    fn flush(&mut self) -> Result<(), String> {
        if let Some((at, slots)) = self.pending.take() {
            self.rows.insert_places(at, &slots)?;
        }
        Ok(())
    }

    /// `applyChanges`'s `rowFor`: the row, brought back if this batch took it out.
    fn row_for(&mut self, id: &str) -> Result<Option<usize>, String> {
        if let Some(slot) = self.rows.slot_of(id) {
            return Ok(Some(slot));
        }
        let Some(gone) = self.removed.remove(id) else { return Ok(None) };
        let end = self.rows.len();
        self.rows.insert_place(end, gone.slot)?;
        self.rows.set_slot_of(id, Some(gone.slot));
        self.rows.set_gone(id, None);
        if let Some(page) = gone.page {
            self.pages.insert(id.to_string(), Some(page.clone()));
            self.effects.push(Effect::Page(id.to_string(), Some(page)));
        }
        if !gone.cells.is_empty() {
            self.cells.entry(id.to_string()).or_default().extend(gone.cells.iter().cloned());
            self.effects.push(Effect::Add(gone.cells));
        }
        Ok(Some(gone.slot))
    }

    fn apply(&mut self, change: Change, computed: &HashSet<String>) -> Result<(), String> {
        // Only an insert straight after another keeps the place it knows: anything else may move rows,
        // and looks at places, so the rows put in so far go in first.
        let chained = match &change {
            Change::Insert { after: After::Row(a), .. } => self.pending.is_some() && self.last_put.as_ref().is_some_and(|(id, _)| id == a),
            _ => false,
        };
        if !chained {
            self.flush()?;
        }
        if !matches!(change, Change::Insert { .. }) {
            self.last_put = None;
        }
        match change {
            Change::Set { row, field, to } => {
                let Some(slot) = self.row_for(&row)? else { return Ok(()) };
                let mut target = values(self.rows, slot)?;
                match to {
                    None => {
                        target.shift_remove(&field);
                    }
                    Some(v) => {
                        target.insert(field, v);
                    }
                }
                let line = render(self.rows.origin_line(slot), &target);
                if line == self.rows.slot_line(slot) {
                    return Ok(());
                }
                // In its own slot while no row has been added, removed or moved.
                let as_read = line == self.rows.origin_line(slot);
                if self.rows.overwrite(slot, &line, as_read)? {
                    return Ok(());
                }
                let origin = self.rows.origin_of(slot);
                let place = self.rows.place_of(slot).expect("a row found is in the table");
                // Back as it was read: its line as read again.
                let next = if line == self.rows.slot_line(origin) { origin } else { self.rows.push_line(&line, Some(origin))? };
                self.rows.replace_place(place, next);
                self.rows.set_slot_of(&row, Some(next));
            }
            Change::Insert { row, values, after, page, cells } => {
                if self.rows.slot_of(&row).is_some() {
                    return Ok(());
                }
                self.removed.remove(&row);
                // Put back as it was taken out (an undo): its line as it was.
                let back = self.rows.gone_slot(&row).filter(|&s| values_same(self.rows, s, &values));
                let slot = match back {
                    Some(s) => s,
                    None => self.rows.push_line(written(&J::Object(values), false).as_bytes(), None)?,
                };
                self.rows.set_gone(&row, None);
                // After the row put in just before it: with it, into the order together.
                let at = match &mut self.pending {
                    Some((from, slots)) if self.last_put.as_ref().is_some_and(|(id, _)| matches!(&after, After::Row(a) if a == id)) => {
                        slots.push(slot);
                        *from + slots.len() - 1
                    }
                    _ => {
                        let at = self.after(&after);
                        self.pending = Some((at, vec![slot]));
                        at
                    }
                };
                self.rows.set_slot_of(&row, Some(slot));
                self.last_put = Some((row.clone(), at));
                if let Some(page) = page {
                    self.pages.insert(row.clone(), Some(page.clone()));
                    self.effects.push(Effect::Page(row.clone(), Some(page)));
                }
                if !cells.is_empty() {
                    self.cells.entry(row).or_default().extend(cells.iter().cloned());
                    self.effects.push(Effect::Add(cells));
                }
            }
            Change::Delete { row, values: was, page, cells } => {
                let Some(slot) = self.rows.slot_of(&row) else { return Ok(()) };
                let now = values(self.rows, slot)?;
                // Changed since the deleting side saw it: that edit stands, and so does the row.
                if !same(Some(&J::Object(stored(&now, computed))), Some(&J::Object(stored(&was, computed)))) {
                    return Ok(());
                }
                let has_page = self.pages.get(&row).cloned().flatten();
                if !same(has_page.as_ref(), page.as_ref()) {
                    return Ok(());
                }
                let has_cells = self.cells.get(&row).cloned().unwrap_or_default();
                if written(&J::Array(has_cells.clone()), true) != written(&J::Array(cells), true) {
                    return Ok(());
                }
                let place = self.rows.place_of(slot).expect("a row found is in the table");
                self.rows.remove_place(place);
                self.rows.set_slot_of(&row, None);
                self.rows.set_gone(&row, Some(slot));
                if has_page.is_some() {
                    self.pages.insert(row.clone(), None);
                    self.effects.push(Effect::Page(row.clone(), None));
                }
                if !has_cells.is_empty() {
                    self.cells.remove(&row);
                    self.effects.push(Effect::Drop(row.clone(), None));
                }
                self.removed.insert(row, Removed { slot, page: has_page, cells: has_cells });
            }
            Change::Move { row, after } => {
                let Some(place) = self.place(&row) else { return Ok(()) };
                let slot = self.rows.remove_place(place);
                let at = self.after(&after);
                self.rows.insert_place(at, slot)?;
            }
            Change::Page { row, to } => {
                if self.row_for(&row)?.is_none() {
                    return Ok(());
                }
                self.pages.insert(row.clone(), to.clone());
                self.effects.push(Effect::Page(row, to));
            }
            Change::Cell { row, field, to } => {
                if self.row_for(&row)?.is_none() {
                    return Ok(());
                }
                let list = self.cells.entry(row.clone()).or_default();
                list.retain(|c| c.get("field").and_then(J::as_str) != Some(field.as_str()));
                self.effects.push(Effect::Drop(row.clone(), Some(field)));
                if let Some(line) = to.filter(|t| !matches!(t, J::Null | J::Bool(false))) {
                    list.push(line.clone());
                    self.effects.push(Effect::Add(vec![line]));
                }
            }
        }
        Ok(())
    }
}

/// `editLog.ts`'s `cellsByRow` for one row: each field's first line, without its id and field.
fn cells_by_field(cells: &[J]) -> Map<String, J> {
    let mut out = Map::new();
    for c in cells {
        let Some(m) = c.as_object() else { continue };
        let Some(field) = m.get("field").and_then(J::as_str) else { continue };
        if out.contains_key(field) {
            continue;
        }
        let mut rest = m.clone();
        rest.shift_remove("id");
        rest.shift_remove("field");
        out.insert(field.to_string(), J::Object(rest));
    }
    out
}

/// `edit-log.ts`'s `rowChanges`: a row's change as history says it.
fn row_changes(out: &mut Vec<J>, id: &str, before: Option<&Map<String, J>>, after: Option<&Map<String, J>>, computed: &HashSet<String>) {
    let event = |pairs: Vec<(&str, J)>| J::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect());
    match (before, after) {
        (None, None) => {}
        (None, Some(a)) => out.push(event(vec![("op", "insert".into()), ("row", id.into()), ("values", J::Object(stored(a, computed)))])),
        (Some(b), None) => out.push(event(vec![("op", "delete".into()), ("row", id.into()), ("values", J::Object(stored(b, computed)))])),
        (Some(b), Some(a)) => {
            let mut seen = HashSet::new();
            for field in js_keys(a).into_iter().chain(js_keys(b)) {
                if field == "id" || computed.contains(field) || !seen.insert(field) {
                    continue;
                }
                let (from, to) = (b.get(field), a.get(field));
                if same_stored(from, to) {
                    continue;
                }
                let mut e = vec![("op", J::from("set")), ("row", id.into()), ("field", field.as_str().into())];
                if !empty(from) {
                    e.push(("from", from.cloned().expect("not empty")));
                }
                if !empty(to) {
                    e.push(("to", to.cloned().expect("not empty")));
                }
                out.push(event(e));
            }
        }
    }
}

/// `rowsChanges`'s events for a row's cells' formulas and notes, before and after.
fn cell_changes(out: &mut Vec<J>, id: &str, before: &Map<String, J>, now: &Map<String, J>) {
    let mut seen = HashSet::new();
    for field in js_keys(before).into_iter().chain(js_keys(now)) {
        if !seen.insert(field) {
            continue;
        }
        for (key, op) in [("expr", "formula"), ("note", "note")] {
            let from = before.get(field).and_then(|c| c.get(key));
            let to = now.get(field).and_then(|c| c.get(key));
            if from != to {
                let mut e = Map::new();
                e.insert("op".into(), op.into());
                e.insert("row".into(), id.into());
                e.insert("field".into(), field.as_str().into());
                if let Some(f) = from {
                    e.insert("from".into(), f.clone());
                }
                if let Some(t) = to {
                    e.insert("to".into(), t.clone());
                }
                out.push(J::Object(e));
            }
        }
    }
}

/// What a batch did: the rows it changed, its edits as history says them, and what the caller
/// does to its pages and cells.
#[derive(Debug)]
pub struct Applied {
    pub changed: Vec<String>,
    pub events: Vec<J>,
    pub effects: Vec<J>,
}

/// What each row a batch names would hold after it, by id (None: not in the table).
pub type NamedAfter = HashMap<String, Option<Map<String, J>>>;

/// The rows a batch names, by id, and what each would hold after it (None: not in the table): the
/// batch applied and taken back, so nothing changes. For the problems a batch could change.
pub fn named_after(rows: &mut Rows, input: &J) -> Result<(Vec<String>, NamedAfter), String> {
    let changes = parse(input.get("changes").and_then(J::as_array).ok_or("the input needs \"changes\", a list")?)?;
    let computed: HashSet<String> = input.get("computed").and_then(J::as_array).map(|xs| xs.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let pages: HashMap<String, Option<J>> = input.get("pages").and_then(J::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), Some(v.clone()))).collect()).unwrap_or_default();
    let mut cells: HashMap<String, Vec<J>> = HashMap::new();
    for c in input.get("cells").and_then(J::as_array).into_iter().flatten() {
        if let Some(id) = c.get("id").and_then(J::as_str) {
            cells.entry(id.to_string()).or_default().push(c.clone());
        }
    }
    let mut named: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for c in &changes {
        if seen.insert(c.row().to_string()) {
            named.push(c.row().to_string());
        }
    }
    let mark = rows.mark();
    let mut batch = Batch { rows, pages, cells, removed: HashMap::new(), effects: Vec::new(), last_put: None, pending: None };
    let mut done = Ok(());
    for change in changes {
        done = batch.apply(change, &computed);
        if done.is_err() {
            break;
        }
    }
    if done.is_ok() {
        done = batch.flush();
    }
    let rows = batch.rows;
    let after: Result<NamedAfter, String> = done.and_then(|()| {
        named.iter().map(|id| Ok((id.clone(), match rows.slot_of(id) { Some(s) => Some(values(rows, s)?), None => None }))).collect()
    });
    rows.undo_to(mark);
    Ok((named, after?))
}

/// `rows.apply`'s work on a held table's rows: `input` has `changes`, and the `pages`, `cells`
/// and `computed` fields of the rows they name. Changes nothing when it's an error.
pub fn apply(rows: &mut Rows, input: &J) -> Result<Applied, String> {
    let changes = parse(input.get("changes").and_then(J::as_array).ok_or("the input needs \"changes\", a list")?)?;
    let computed: HashSet<String> = input.get("computed").and_then(J::as_array).map(|xs| xs.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let pages: HashMap<String, Option<J>> = input.get("pages").and_then(J::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), Some(v.clone()))).collect()).unwrap_or_default();
    let mut cells: HashMap<String, Vec<J>> = HashMap::new();
    for c in input.get("cells").and_then(J::as_array).into_iter().flatten() {
        if let Some(id) = c.get("id").and_then(J::as_str) {
            cells.entry(id.to_string()).or_default().push(c.clone());
        }
    }
    // The rows named, as they were: what history compares with.
    let mut named: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for c in &changes {
        if seen.insert(c.row().to_string()) {
            named.push(c.row().to_string());
        }
    }
    // Each row's place, line and values.
    type Was = (usize, Vec<u8>, Map<String, J>);
    let mut before: HashMap<String, Was> = HashMap::new();
    for id in &named {
        if let Some(slot) = rows.slot_of(id) {
            let place = rows.place_of(slot).expect("a row found is in the table");
            before.insert(id.clone(), (place, rows.slot_line(slot).to_vec(), values(rows, slot)?));
        }
    }
    let cells_before: HashMap<String, Map<String, J>> = named.iter().map(|id| (id.clone(), cells_by_field(cells.get(id).map_or(&[][..], Vec::as_slice)))).collect();

    let mark = rows.mark();
    let mut batch = Batch { rows, pages, cells, removed: HashMap::new(), effects: Vec::new(), last_put: None, pending: None };
    let mut done = Ok(());
    for change in changes {
        done = batch.apply(change, &computed);
        if done.is_err() {
            break;
        }
    }
    if done.is_ok() {
        done = batch.flush();
    }
    let Batch { rows, cells, effects, .. } = batch;
    if let Err(e) = done {
        rows.undo_to(mark);
        return Err(e);
    }
    // Worked out before the edit is kept: a read that fails after it would say nothing changed when it had.
    let finish = |rows: &mut Rows| -> Result<Applied, String> {
        // After: in the order the rows are now, then the rows that have gone, as rowsChanges says them.
        let mut now: Vec<(usize, String, usize)> = Vec::new();
        let mut gone: Vec<(usize, String)> = Vec::new();
        let mut changed = Vec::new();
        for id in &named {
            let slot = rows.slot_of(id);
            let place = slot.and_then(|s| rows.place_of(s));
            let was = before.get(id);
            match (slot.zip(place), was) {
                (Some((s, p)), _) => {
                    now.push((p, id.clone(), s));
                    if was.is_none_or(|(wp, line, _)| *wp != p || line.as_slice() != rows.slot_line(s)) {
                        changed.push(id.clone());
                    }
                }
                (None, Some((wp, _, _))) => {
                    gone.push((*wp, id.clone()));
                    changed.push(id.clone());
                }
                (None, None) => {}
            }
        }
        now.sort_unstable();
        gone.sort_unstable();
        let mut events = Vec::new();
        let empty_cells = Map::new();
        for (_, id, slot) in &now {
            let was = before.get(id).map(|(_, _, v)| v);
            let after = values(rows, *slot)?;
            let mut these = Vec::new();
            row_changes(&mut these, id, was, Some(&after), &computed);
            let cells_now = cells_by_field(cells.get(id).map_or(&[][..], Vec::as_slice));
            for e in &mut these {
                if e["op"] == "insert" && !cells_now.is_empty() {
                    e.as_object_mut().expect("an event").insert("cells".into(), J::Object(cells_now.clone()));
                }
            }
            events.extend(these);
            if was.is_some() {
                cell_changes(&mut events, id, cells_before.get(id).unwrap_or(&empty_cells), &cells_now);
            }
        }
        for (_, id) in &gone {
            let was = &before[id].2;
            let mut these = Vec::new();
            row_changes(&mut these, id, Some(was), None, &computed);
            let cells_were = cells_before.get(id).unwrap_or(&empty_cells);
            for e in &mut these {
                if !cells_were.is_empty() {
                    e.as_object_mut().expect("an event").insert("cells".into(), J::Object(cells_were.clone()));
                }
            }
            events.extend(these);
        }
        let effects = effects
            .into_iter()
            .map(|e| {
                let mut m = Map::new();
                match e {
                    Effect::Page(row, to) => {
                        m.insert("op".into(), "page".into());
                        m.insert("row".into(), row.into());
                        if let Some(t) = to {
                            m.insert("to".into(), t);
                        }
                    }
                    Effect::Drop(row, field) => {
                        m.insert("op".into(), "cells-drop".into());
                        m.insert("row".into(), row.into());
                        if let Some(f) = field {
                            m.insert("field".into(), f.into());
                        }
                    }
                    Effect::Add(cells) => {
                        m.insert("op".into(), "cells-add".into());
                        m.insert("cells".into(), J::Array(cells));
                    }
                }
                J::Object(m)
            })
            .collect();
        Ok(Applied { changed, events, effects })
    };
    match finish(rows) {
        Ok(applied) => {
            rows.commit(mark);
            Ok(applied)
        }
        Err(e) => {
            rows.undo_to(mark);
            Err(e)
        }
    }
}

/// A value as JavaScript's JSON.stringify writes it, for answers.
pub fn json(v: &J) -> String {
    written(v, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn table(lines: &[&str]) -> Rows {
        let mut r = Rows::new(&["title".into(), "status".into()]);
        r.read("rows/0001.ndjson", lines.join("\n").into_bytes(), true).unwrap();
        r
    }

    fn lines(r: &Rows) -> Vec<String> {
        (0..r.len()).map(|i| String::from_utf8_lossy(r.line(i)).into_owned()).collect()
    }

    fn run(r: &mut Rows, changes: J) -> Applied {
        apply(r, &json!({ "changes": changes })).unwrap()
    }

    #[test]
    fn a_value_changed_is_written_in_its_place_and_the_rest_keep_their_bytes() {
        let mut r = table(&[r#"{"id":"a", "title":"A",  "n":1.50, "status":"todo"}"#, r#"{"id":"b"}"#]);
        let got = run(&mut r, json!([{ "op": "set", "row": "a", "field": "title", "to": "A\n2" }]));
        assert_eq!(lines(&r)[0], r#"{"id":"a", "title":"A\n2",  "n":1.50, "status":"todo"}"#);
        assert_eq!(got.changed, vec!["a"]);
        assert_eq!(got.events, vec![json!({ "op": "set", "row": "a", "field": "title", "from": "A", "to": "A\n2" })]);
        // Taken out, and a key new at the end.
        run(&mut r, json!([{ "op": "set", "row": "a", "field": "n" }, { "op": "set", "row": "a", "field": "due", "to": [1, 2] }]));
        assert_eq!(lines(&r)[0], r#"{"id":"a", "title":"A\n2", "status":"todo","due":[1,2]}"#);
        // Back as it was read: its line as read, byte for byte.
        run(&mut r, json!([{ "op": "set", "row": "a", "field": "due" }, { "op": "set", "row": "a", "field": "n", "to": 1.5 }, { "op": "set", "row": "a", "field": "title", "to": "A" }]));
        assert_eq!(lines(&r)[0], r#"{"id":"a", "title":"A",  "n":1.50, "status":"todo"}"#);
        assert_eq!(r.text(0, r.cells(0)[0]).as_deref(), Some("A"));
        assert_eq!(r.row_of("b"), Some(1));
    }

    #[test]
    fn rows_inserted_moved_and_removed_are_where_apply_changes_puts_them() {
        let mut r = table(&[r#"{"id":"a"}"#, r#"{"id":"b"}"#, r#"{"id":"c"}"#]);
        run(&mut r, json!([
            { "op": "insert", "row": "x", "values": { "id": "x", "title": "X" }, "after": "a" },
            { "op": "insert", "row": "y", "values": { "id": "y" }, "after": null },
            { "op": "move", "row": "c", "after": "y" },
            { "op": "delete", "row": "b", "values": { "id": "b" } },
            { "op": "insert", "row": "z", "values": { "id": "z" }, "after": "gone" },
        ]));
        let ids: Vec<String> = (0..r.len()).map(|i| r.id(i)).collect();
        assert_eq!(ids, ["y", "c", "a", "x", "z"]);
        assert_eq!(r.row_of("x"), Some(3));
        assert_eq!(r.row_of("b"), None);
        assert_eq!(lines(&r)[3], r#"{"id":"x","title":"X"}"#);
    }

    /// A batch, then the changes that undo it, made from the rows as they were before it (as an
    /// undo keeps them): every row is its line as read again, byte for byte. Its events, turned
    /// round, give back the same values; history says nothing of an empty value written as
    /// another (absent, null and "" are one: SPEC section 3), so those bytes it can't.
    #[test]
    fn a_batch_and_then_its_undo_give_back_the_rows_bytes_and_its_events_their_values() {
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        let mut int = |n: usize| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % n as u64) as usize
        };
        let written_as = [r#""A""#, r#""\u00e9""#, "1.50", "1e2", "[1, 2]", r#"{"k" : 1}"#, "null", "true", r#""""#, "-0"];
        let values = [json!("B"), json!("é"), json!(1.5), json!(100), json!([1, 2]), json!({ "k": 1 }), J::Null, json!(false), json!(""), json!(0)];
        for round in 0..300 {
            let n = 1 + int(8);
            let text: Vec<String> = (0..n)
                .map(|i| {
                    let mut line = format!(r#"{{ "id":"r{i}""#);
                    for key in ["title", "status", "x"] {
                        if int(3) != 0 {
                            line.push_str(&format!(r#",  "{key}": {}"#, written_as[int(written_as.len())]));
                        }
                    }
                    line.push_str(" }");
                    line
                })
                .collect();
            let mut r = table(&text.iter().map(String::as_str).collect::<Vec<_>>());
            let read = lines(&r);
            let ids: Vec<String> = (0..n).map(|i| r.id(i)).collect();
            let mut changes = Vec::new();
            for _ in 0..1 + int(6) {
                let row = ids[int(n)].clone();
                let field = ["title", "status", "x", "new"][int(4)];
                let to = values[int(values.len())].clone();
                let kind = int(5);
                let held = r.row_of(&row).map(|p| serde_json::from_slice::<J>(r.line(p)).unwrap());
                match (kind, held) {
                    (0, Some(was)) => changes.push(json!({ "op": "delete", "row": row, "values": was })),
                    (1, _) => changes.push(json!({ "op": "set", "row": row, "field": field })),
                    _ => changes.push(json!({ "op": "set", "row": row, "field": field, "to": to })),
                }
            }
            let before: Vec<(String, Map<String, J>)> = (0..r.len()).map(|i| (r.id(i), serde_json::from_slice::<J>(r.line(i)).unwrap().as_object().unwrap().clone())).collect();
            let done = run(&mut r, J::Array(changes.clone()));
            // Put back after the row before it that's still there.
            let after_of = |r: &Rows, at: usize| before[..at].iter().rev().find(|(id, _)| r.row_of(id).is_some()).map_or(J::Null, |(id, _)| json!(id));
            let mut undo = Vec::new();
            for (at, (id, was)) in before.iter().enumerate() {
                match r.row_of(id) {
                    None => undo.push(json!({ "op": "insert", "row": id, "values": was, "after": after_of(&r, at) })),
                    Some(p) => {
                        let now = serde_json::from_slice::<J>(r.line(p)).unwrap();
                        for k in now.as_object().unwrap().keys().chain(was.keys()).filter(|k| *k != "id") {
                            match was.get(k) {
                                Some(v) => undo.push(json!({ "op": "set", "row": id, "field": k, "to": v })),
                                None => undo.push(json!({ "op": "set", "row": id, "field": k })),
                            }
                        }
                    }
                }
            }
            // And each row where it was: one an edit brought back is at the end.
            for (at, (id, _)) in before.iter().enumerate() {
                undo.push(json!({ "op": "move", "row": id, "after": if at == 0 { J::Null } else { json!(before[at - 1].0) } }));
            }
            // The events, turned round, on a copy: the same values, an empty one perhaps written as another.
            let mut events_undo = Vec::new();
            for e in done.events.iter().rev() {
                let row = e["row"].as_str().unwrap();
                events_undo.push(match e["op"].as_str().unwrap() {
                    "set" => match e.get("from") {
                        Some(from) => json!({ "op": "set", "row": row, "field": e["field"], "to": from }),
                        None => json!({ "op": "set", "row": row, "field": e["field"] }),
                    },
                    "delete" => {
                        let at = before.iter().position(|(id, _)| id == row).unwrap();
                        json!({ "op": "insert", "row": row, "values": e["values"], "after": after_of(&r, at) })
                    }
                    op => panic!("{op}"),
                });
            }
            let mut copy = table(&lines(&r).iter().map(String::as_str).collect::<Vec<_>>());
            // The copy reads the rows in their order now: its deletes put back where they were.
            run(&mut copy, J::Array(events_undo));
            run(&mut r, J::Array(undo));
            assert_eq!(lines(&r), read, "round {round}: {changes:?}");
            let empty_as_absent = |line: &str| {
                let mut m = serde_json::from_str::<J>(line).unwrap().as_object().unwrap().clone();
                m.retain(|_, v| !empty(Some(v)));
                // As JavaScript has it: 1e2 is 100.
                written(&J::Object(m), true)
            };
            // History says nothing of order: the rows, in any.
            let mut got: Vec<String> = lines(&copy).iter().map(|l| empty_as_absent(l)).collect();
            let mut want: Vec<String> = read.iter().map(|l| empty_as_absent(l)).collect();
            got.sort();
            want.sort();
            assert_eq!(got, want, "round {round}, by its events: {changes:?}");
            assert_eq!((0..r.len()).map(|i| r.id(i)).collect::<Vec<_>>(), ids);
        }
    }

    #[test]
    fn a_batch_the_engine_cant_take_changes_nothing() {
        let mut r = table(&[r#"{"id":"a","title":"A"}"#, r#"{"id":"b"}"#]);
        let before = lines(&r);
        let err = apply(&mut r, &json!({ "changes": [
            { "op": "set", "row": "a", "field": "title", "to": "changed" },
            { "op": "delete", "row": "b", "values": { "id": "b" } },
            { "op": "field", "table": "t", "name": "title" },
        ] }));
        assert!(err.is_err());
        assert_eq!(lines(&r), before);
        assert!(apply(&mut r, &json!({ "changes": [{ "op": "insert", "row": "q", "values": { "id": "other" }, "after": null }] })).unwrap_err().contains("another id"));
        // Applied as far as a failure, then put back: a row holding a number JavaScript can't.
        let mut r = table(&[r#"{"id":"a","title":"A"}"#, r#"{"id":"b"}"#, r#"{"id":"c","n":1e400}"#]);
        let before = lines(&r);
        let err = apply(&mut r, &json!({ "changes": [
            { "op": "set", "row": "a", "field": "title", "to": "changed" },
            { "op": "delete", "row": "b", "values": { "id": "b" } },
            { "op": "insert", "row": "q", "values": { "id": "q" }, "after": "a" },
            { "op": "set", "row": "c", "field": "title", "to": "x" },
        ] }));
        assert!(err.unwrap_err().contains("can't read back"));
        assert_eq!(lines(&r), before);
        assert_eq!((r.row_of("a"), r.row_of("b"), r.row_of("c"), r.row_of("q")), (Some(0), Some(1), Some(2), None));
        assert_eq!(r.id(1), "b");
    }
}
