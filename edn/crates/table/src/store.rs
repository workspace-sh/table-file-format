//! SPIKE (table-file-format#867): a table's rows read from an archive's
//! bytes into typed columns the engine holds, to time against today's
//! JavaScript read. Not for merging: no writing back, no key order for
//! extra fields, one table per archive.

use std::borrow::Cow;
use std::collections::HashMap;

use serde::de::{Deserializer, MapAccess, Visitor};
use serde_json::value::RawValue;

/// Bits: one per row.
#[derive(Default)]
pub struct Bits(Vec<u64>);

impl Bits {
    fn push(&mut self, row: usize, on: bool) {
        if row / 64 >= self.0.len() {
            self.0.push(0);
        }
        if on {
            self.0[row / 64] |= 1 << (row % 64);
        }
    }
    pub fn get(&self, row: usize) -> bool {
        self.0.get(row / 64).is_some_and(|w| w & (1 << (row % 64)) != 0)
    }
}

/// Text cells end to end, with where each ends; an absent cell is empty and not `present`.
#[derive(Default)]
pub struct Texts {
    pub bytes: Vec<u8>,
    pub ends: Vec<u32>,
    pub present: Bits,
}

impl Texts {
    fn push(&mut self, row: usize, text: Option<&str>) {
        if let Some(t) = text {
            self.bytes.extend_from_slice(t.as_bytes());
        }
        self.ends.push(self.bytes.len() as u32);
        self.present.push(row, text.is_some());
    }
    pub fn get(&self, row: usize) -> Option<&str> {
        if !self.present.get(row) {
            return None;
        }
        let start = if row == 0 { 0 } else { self.ends[row - 1] as usize };
        std::str::from_utf8(&self.bytes[start..self.ends[row] as usize]).ok()
    }
}

/// A field's cells, typed by its schema type.
pub enum Column {
    Text(Texts),
    /// NaN: absent (JSON has no NaN to confuse it with).
    Number(Vec<f64>),
    /// 0 false, 1 true, 2 absent.
    Bool(Vec<u8>),
}

impl Column {
    fn bytes(&self) -> usize {
        match self {
            Column::Text(t) => t.bytes.capacity() + t.ends.capacity() * 4 + t.present.0.capacity() * 8,
            Column::Number(v) => v.capacity() * 8,
            Column::Bool(v) => v.capacity(),
        }
    }
}

/// A table's rows, held by the engine.
pub struct Store {
    pub names: Vec<String>,
    pub ids: Texts,
    pub columns: Vec<Column>,
    /// Cells that don't fit their field's type, and keys the schema doesn't name: row, key, value as JSON.
    pub other: Vec<(u32, String, Box<str>)>,
    /// Lines that aren't rows (not JSON, no id, an id repeated), as written: line number, text.
    pub unread: Vec<(u32, String)>,
    by_id: HashMap<u64, u32>,
    by_id_collisions: HashMap<Vec<u8>, u32>,
}

fn fxhash(b: &[u8]) -> u64 {
    let mut h: u64 = 0;
    for chunk in b.chunks(8) {
        let mut w = [0u8; 8];
        w[..chunk.len()].copy_from_slice(chunk);
        h = (h.rotate_left(5) ^ u64::from_le_bytes(w)).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
    h ^ b.len() as u64
}

impl Store {
    pub fn new(fields: &[(String, String)]) -> Self {
        let columns = fields
            .iter()
            .map(|(_, ty)| match ty.as_str() {
                "number" | "integer" | "year" => Column::Number(Vec::new()),
                "boolean" => Column::Bool(Vec::new()),
                _ => Column::Text(Texts::default()),
            })
            .collect();
        Store {
            names: fields.iter().map(|(n, _)| n.clone()).collect(),
            ids: Texts::default(),
            columns,
            other: Vec::new(),
            unread: Vec::new(),
            by_id: HashMap::new(),
            by_id_collisions: HashMap::new(),
        }
    }

    pub fn rows(&self) -> usize {
        self.ids.ends.len()
    }

    /// The bytes the store holds.
    pub fn bytes(&self) -> usize {
        self.ids.bytes.capacity()
            + self.ids.ends.capacity() * 4
            + self.columns.iter().map(Column::bytes).sum::<usize>()
            + self.other.iter().map(|(_, k, v)| 32 + k.len() + v.len()).sum::<usize>()
            + self.by_id.capacity() * 16
    }

    fn seen(&mut self, id: &str, row: u32) -> bool {
        let h = fxhash(id.as_bytes());
        match self.by_id.get(&h) {
            None => {
                self.by_id.insert(h, row);
                false
            }
            Some(&r) if self.ids.get(r as usize) == Some(id) => true,
            Some(_) => self.by_id_collisions.insert(id.as_bytes().to_vec(), row).is_some(),
        }
    }

    /// Rows from NDJSON, skip-and-collect (SPEC section 3).
    pub fn read_rows(&mut self, ndjson: &[u8], index: &HashMap<&str, usize>) {
        let mut cells: Vec<Option<&RawValue>> = Vec::new();
        for (n, line) in ndjson.split(|b| *b == b'\n').enumerate() {
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            cells.clear();
            cells.resize(self.columns.len(), None);
            let mut id: Option<Cow<str>> = None;
            let mut others: Vec<(String, &RawValue)> = Vec::new();
            let ok = {
                let mut de = serde_json::Deserializer::from_slice(line);
                de.deserialize_map(RowVisitor { index, cells: &mut cells, id: &mut id, others: &mut others }).is_ok() && de.end().is_ok()
            };
            let row = self.rows() as u32;
            let Some(id) = id.filter(|i| ok && !i.is_empty()) else {
                self.unread.push((n as u32, String::from_utf8_lossy(line).into_owned()));
                continue;
            };
            if self.seen(&id, row) {
                self.unread.push((n as u32, String::from_utf8_lossy(line).into_owned()));
                continue;
            }
            self.ids.push(row as usize, Some(&id));
            for (c, column) in self.columns.iter_mut().enumerate() {
                let cell = cells[c];
                let fits = put(column, row as usize, cell);
                if !fits {
                    self.other.push((row, self.names[c].clone(), cell.map_or_else(|| "null".into(), |v| v.get().into())));
                }
            }
            for (k, v) in others {
                self.other.push((row, k, v.get().into()));
            }
        }
    }
}

/// Puts a cell in its column; false when it doesn't fit the column's type (an empty cell takes its place).
fn put(column: &mut Column, row: usize, cell: Option<&RawValue>) -> bool {
    let raw = cell.map(RawValue::get);
    match column {
        Column::Text(t) => match raw {
            None | Some("null") => t.push(row, None),
            Some(r) if r.starts_with('"') && !r.contains('\\') => t.push(row, Some(&r[1..r.len() - 1])),
            Some(r) if r.starts_with('"') => match serde_json::from_str::<String>(r) {
                Ok(s) => t.push(row, Some(&s)),
                Err(_) => {
                    t.push(row, None);
                    return false;
                }
            },
            Some(_) => {
                t.push(row, None);
                return false;
            }
        },
        Column::Number(v) => match raw {
            None | Some("null") => v.push(f64::NAN),
            Some(r) => match r.parse::<f64>() {
                Ok(n) => v.push(n),
                Err(_) => {
                    v.push(f64::NAN);
                    return false;
                }
            },
        },
        Column::Bool(v) => match raw {
            None | Some("null") => v.push(2),
            Some("true") => v.push(1),
            Some("false") => v.push(0),
            Some(_) => {
                v.push(2);
                return false;
            }
        },
    }
    true
}

struct RowVisitor<'v, 'de> {
    index: &'v HashMap<&'v str, usize>,
    cells: &'v mut Vec<Option<&'de RawValue>>,
    id: &'v mut Option<Cow<'de, str>>,
    others: &'v mut Vec<(String, &'de RawValue)>,
}

impl<'v, 'de> Visitor<'de> for RowVisitor<'v, 'de> {
    type Value = ();
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a row")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        while let Some(key) = map.next_key::<Cow<'de, str>>()? {
            let value: &'de RawValue = map.next_value()?;
            if key == "id" {
                let raw = value.get();
                *self.id = if raw.starts_with('"') && !raw.contains('\\') {
                    Some(Cow::Borrowed(&raw[1..raw.len() - 1]))
                } else {
                    serde_json::from_str::<String>(raw).ok().map(Cow::Owned)
                };
            } else if let Some(&c) = self.index.get(&*key) {
                self.cells[c] = Some(value);
            } else {
                self.others.push((key.into_owned(), value));
            }
        }
        Ok(())
    }
}

/// The schema's fields, as (name, type).
pub fn fields_of(schema: &str) -> Result<Vec<(String, String)>, String> {
    let v: serde_json::Value = serde_json::from_str(schema).map_err(|e| e.to_string())?;
    Ok(v.get("fields")
        .and_then(|f| f.as_array())
        .ok_or("no fields")?
        .iter()
        .filter_map(|f| Some((f.get("name")?.as_str()?.to_string(), f.get("type").and_then(|t| t.as_str()).unwrap_or("string").to_string())))
        .collect())
}

/// Rows from NDJSON for `schema`, into a new store.
pub fn parse(schema: &str, ndjson: &[u8]) -> Result<Store, String> {
    let fields = fields_of(schema)?;
    let mut store = Store::new(&fields);
    let index: HashMap<&str, usize> = fields.iter().enumerate().map(|(i, (n, _))| (n.as_str(), i)).collect();
    store.read_rows(ndjson, &index);
    Ok(store)
}

/// A zip's entries: name, and the data inflated.
pub fn unzip(bytes: &[u8], wanted: impl Fn(&str) -> bool) -> Result<Vec<(String, Vec<u8>)>, String> {
    let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]) as usize;
    let u32_at = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
    let eocd = (0..bytes.len().saturating_sub(21)).rev().take(65_557).find(|&i| u32_at(i) == 0x0605_4b50).ok_or("not a zip")?;
    let (count, mut at) = (u16_at(eocd + 10), u32_at(eocd + 16));
    let mut out = Vec::new();
    for _ in 0..count {
        if u32_at(at) != 0x0201_4b50 {
            return Err("bad central directory".into());
        }
        let (method, compressed, size) = (u16_at(at + 10), u32_at(at + 20), u32_at(at + 24));
        let (name_len, extra_len, comment_len, local) = (u16_at(at + 28), u16_at(at + 30), u16_at(at + 32), u32_at(at + 42));
        let name = String::from_utf8_lossy(&bytes[at + 46..at + 46 + name_len]).into_owned();
        at += 46 + name_len + extra_len + comment_len;
        if !wanted(&name) {
            continue;
        }
        let data_at = local + 30 + u16_at(local + 26) + u16_at(local + 28);
        let data = &bytes[data_at..data_at + compressed];
        let inflated = match method {
            0 => data.to_vec(),
            8 => miniz_oxide::inflate::decompress_to_vec_with_limit(data, size).map_err(|e| format!("{name}: {e:?}"))?,
            m => return Err(format!("{name}: method {m}")),
        };
        out.push((name, inflated));
    }
    Ok(out)
}

/// An archive's first table, read into a store: its schema, then its rows files in order.
pub fn open(bytes: &[u8]) -> Result<Store, String> {
    let mut entries = unzip(bytes, |n| n.ends_with("/schema.json") || (n.contains("/rows/") && n.ends_with(".ndjson")))?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let schema = entries.iter().find(|(n, _)| n.ends_with("/schema.json")).ok_or("no schema")?;
    let fields = fields_of(std::str::from_utf8(&schema.1).map_err(|e| e.to_string())?)?;
    let mut store = Store::new(&fields);
    let index: HashMap<&str, usize> = fields.iter().enumerate().map(|(i, (n, _))| (n.as_str(), i)).collect();
    for (_, rows) in entries.iter().filter(|(n, _)| n.contains("/rows/")) {
        store.read_rows(rows, &index);
    }
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_into_columns_skip_and_collect() {
        let schema = r#"{"fields":[{"name":"t","type":"string"},{"name":"n","type":"number"},{"name":"b","type":"boolean"}]}"#;
        let s = parse(schema, b"{\"id\":\"a\",\"t\":\"x\\\"y\",\"n\":1.5,\"b\":true,\"z\":[1]}\nnot json\n{\"id\":\"a\"}\n\n{\"id\":\"b\",\"n\":\"oops\"}").unwrap();
        assert_eq!(s.rows(), 2);
        assert_eq!(s.ids.get(1), Some("b"));
        let Column::Text(t) = &s.columns[0] else { panic!() };
        assert_eq!((t.get(0), t.get(1)), (Some("x\"y"), None));
        let Column::Number(n) = &s.columns[1] else { panic!() };
        assert!(n[0] == 1.5 && n[1].is_nan());
        assert_eq!(s.unread.len(), 2);
        assert_eq!(s.other.len(), 2); // z on a, n on b
    }
}
