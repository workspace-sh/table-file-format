//! A table's rows, held by the engine (table-file-format#867, step 1).
//!
//! Rows files are read as their bytes, compressed or not, one at a time, and
//! kept as read: every row is a span of its file, and every cell a span of
//! its row with its JSON kind. Nothing is re-written, so a row nobody edits
//! can be written back byte for byte (key order, spacing, numbers as
//! written), and a value is decoded only when it's asked for.
//!
//! Lines that aren't rows are kept as the reader contract says (SPEC section
//! 3, skip-and-collect): their place, and why. The words a reader shows for
//! them are the caller's to write.

use std::collections::HashMap;

use serde::de::{Deserializer, MapAccess, Visitor};
use serde_json::value::RawValue;

/// A cell's kind: what its JSON is.
pub mod kind {
    pub const ABSENT: u8 = 0;
    pub const NULL: u8 = 1;
    pub const NUMBER: u8 = 2;
    /// Text with nothing escaped: its bytes are the value.
    pub const TEXT: u8 = 3;
    /// Text with escapes: decoded when asked for.
    pub const ESCAPED: u8 = 4;
    pub const TRUE: u8 = 5;
    pub const FALSE: u8 = 6;
    /// An array or object, as written.
    pub const JSON: u8 = 7;
}

/// Where a value is in its row's line, and its kind. For text, the span is
/// inside the quotes.
/// Packed: nine bytes, not twelve, a cell; a million rows of eight fields hold 72 MB of them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C, packed)]
pub struct Cell {
    pub start: u32,
    pub len: u32,
    pub kind: u8,
}

/// Why a line isn't a row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineIs {
    NotJson,
    NotRow,
    NoId,
    /// Its id is a row's before it (that row's index).
    Repeat(u32),
}

/// A line that isn't a row: its file, its line number from 0, why, how many
/// rows came before it, and where its text is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Line {
    pub file: u32,
    pub line: u32,
    pub is: LineIs,
    pub rows_before: u32,
    pub start: u32,
    pub len: u32,
}

/// A key the schema doesn't name, in a row, and its value.
#[derive(Clone, Debug)]
pub struct Extra {
    pub row: u32,
    pub key: String,
    pub value: Cell,
}

#[derive(Clone, Copy, Debug)]
struct RowAt {
    file: u32,
    start: u32,
    len: u32,
}

/// A table's rows, held by the engine.
pub struct Rows {
    names: Vec<String>,
    by_name: HashMap<String, usize>,
    files: Vec<(String, Vec<u8>)>,
    rows: Vec<RowAt>,
    ids: Vec<Cell>,
    /// Row-major: `rows × names`.
    cells: Vec<Cell>,
    /// By row, in row order.
    extras: Vec<Extra>,
    lines: Vec<Line>,
    by_id: HashMap<u64, u32>,
    by_id_rest: HashMap<Box<[u8]>, u32>,
}

fn hash(b: &[u8]) -> u64 {
    // FNV-1a: ids are short, and this needs no state between runs.
    b.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, c| (h ^ u64::from(*c)).wrapping_mul(0x100_0000_01b3))
}

/// JavaScript's `trim()` would leave nothing: every character is white space
/// or a line end as ECMAScript counts them.
fn blank(line: &[u8]) -> bool {
    // Nearly every line starts with `{`: no need to look further.
    match line.first() {
        None => return true,
        Some(&b) if b.is_ascii() && !matches!(b, b'\t' | b'\n' | 0x0b | 0x0c | b'\r' | b' ') => return false,
        _ => {}
    }
    std::str::from_utf8(line).map_or(false, |s| {
        s.chars().all(|c| matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
    })
}

/// A value's kind and span (relative to `line`) from its raw JSON.
fn cell_of(line: &[u8], raw: &RawValue) -> Cell {
    let text = raw.get();
    let start = text.as_ptr() as usize - line.as_ptr() as usize;
    let b = text.as_bytes();
    let (kind, start, len) = match b.first() {
        Some(b'"') => (if b.contains(&b'\\') { kind::ESCAPED } else { kind::TEXT }, start + 1, b.len() - 2),
        Some(b't') => (kind::TRUE, start, b.len()),
        Some(b'f') => (kind::FALSE, start, b.len()),
        Some(b'n') => (kind::NULL, start, b.len()),
        Some(b'[' | b'{') => (kind::JSON, start, b.len()),
        _ => (kind::NUMBER, start, b.len()),
    };
    Cell { start: start as u32, len: len as u32, kind }
}

impl Rows {
    /// A table's rows, none yet, for the fields its schema names.
    pub fn new(fields: &[String]) -> Rows {
        Rows {
            names: fields.to_vec(),
            by_name: fields.iter().enumerate().map(|(i, n)| (n.clone(), i)).collect(),
            files: Vec::new(),
            rows: Vec::new(),
            ids: Vec::new(),
            cells: Vec::new(),
            extras: Vec::new(),
            lines: Vec::new(),
            by_id: HashMap::new(),
            by_id_rest: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn names(&self) -> &[String] {
        &self.names
    }

    pub fn lines(&self) -> &[Line] {
        &self.lines
    }

    /// The bytes held: the files as read, and the spans over them.
    pub fn bytes(&self) -> usize {
        self.files.iter().map(|(n, b)| n.len() + b.capacity()).sum::<usize>()
            + self.rows.capacity() * std::mem::size_of::<RowAt>()
            + (self.ids.capacity() + self.cells.capacity()) * std::mem::size_of::<Cell>()
            + self.extras.capacity() * std::mem::size_of::<Extra>()
            + self.by_id.capacity() * 16
    }

    /// A row's line, as read.
    pub fn line(&self, row: usize) -> &[u8] {
        let r = self.rows[row];
        &self.files[r.file as usize].1[r.start as usize..(r.start + r.len) as usize]
    }

    /// A line that isn't a row, as read.
    pub fn unread(&self, l: &Line) -> &[u8] {
        &self.files[l.file as usize].1[l.start as usize..(l.start + l.len) as usize]
    }

    /// A row's id.
    pub fn id(&self, row: usize) -> String {
        self.text(row, self.ids[row]).unwrap_or_default()
    }

    /// Where a row's id is in its line.
    pub fn id_cell(&self, row: usize) -> Cell {
        self.ids[row]
    }

    /// A cell's bytes in its row.
    pub fn raw(&self, row: usize, c: Cell) -> &[u8] {
        &self.line(row)[c.start as usize..(c.start + c.len) as usize]
    }

    /// A text cell's value, unescaped. None for a cell that isn't text.
    pub fn text(&self, row: usize, c: Cell) -> Option<String> {
        match c.kind {
            kind::TEXT => Some(String::from_utf8_lossy(self.raw(row, c)).into_owned()),
            kind::ESCAPED => {
                let line = self.line(row);
                serde_json::from_slice(&line[c.start as usize - 1..(c.start + c.len) as usize + 1]).ok()
            }
            _ => None,
        }
    }

    /// A row's cells, in the schema's order.
    pub fn cells(&self, row: usize) -> &[Cell] {
        let n = self.names.len();
        &self.cells[row * n..(row + 1) * n]
    }

    /// The keys the schema doesn't name, in a row.
    pub fn extras(&self, row: usize) -> &[Extra] {
        let row = row as u32;
        let from = self.extras.partition_point(|e| e.row < row);
        let to = self.extras.partition_point(|e| e.row <= row);
        &self.extras[from..to]
    }

    /// The row an id is, if any.
    pub fn row_of(&self, id: &str) -> Option<usize> {
        let found = match self.by_id.get(&hash(id.as_bytes())) {
            Some(&r) if self.id(r as usize) == id => Some(r),
            _ => self.by_id_rest.get(id.as_bytes()).copied(),
        };
        found.map(|r| r as usize)
    }

    /// A row's id, its line in `reading` when it's a row of the file being read.
    fn id_reading(&self, row: usize, reading: (u32, &[u8])) -> Option<String> {
        let r = self.rows[row];
        let file: &[u8] = if r.file == reading.0 { reading.1 } else { &self.files[r.file as usize].1 };
        let line = &file[r.start as usize..(r.start + r.len) as usize];
        let c = self.ids[row];
        match c.kind {
            kind::TEXT => std::str::from_utf8(&line[c.start as usize..(c.start + c.len) as usize]).ok().map(str::to_string),
            _ => serde_json::from_slice(&line[c.start as usize - 1..(c.start + c.len) as usize + 1]).ok(),
        }
    }

    fn take_id(&mut self, id: &str, row: u32, reading: (u32, &[u8])) -> Option<u32> {
        let h = hash(id.as_bytes());
        match self.by_id.get(&h) {
            Some(&r) if self.id_reading(r as usize, reading).as_deref() == Some(id) => return Some(r),
            _ => {
                if let Some(&r) = self.by_id_rest.get(id.as_bytes()) {
                    return Some(r);
                }
            }
        }
        if self.by_id.contains_key(&h) {
            self.by_id_rest.insert(id.as_bytes().into(), row);
        } else {
            self.by_id.insert(h, row);
        }
        None
    }

    /// Reads one rows file, as text (`bytes`, a file's bytes in UTF-8).
    /// `strip_bom`: a byte order mark at its start isn't part of its first
    /// line (as a reader that decodes it with `TextDecoder` reads it). Text
    /// that isn't UTF-8 is read with U+FFFD in its place, as `TextDecoder`
    /// reads it. Returns how many rows it held.
    pub fn read(&mut self, name: &str, bytes: Vec<u8>, strip_bom: bool) -> usize {
        let mut bytes = match String::from_utf8(bytes) {
            Ok(s) => s.into_bytes(),
            Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned().into_bytes(),
        };
        if strip_bom && bytes.starts_with("\u{feff}".as_bytes()) {
            bytes.drain(..3);
        }
        let file = self.files.len() as u32;
        let before = self.rows.len();
        let n = self.names.len();
        // At most a row a line: reserved once, so the lists don't grow to twice what they hold.
        let lines = bytes.iter().filter(|b| **b == b'\n').count() + 1;
        self.rows.reserve_exact(lines);
        self.ids.reserve_exact(lines);
        self.cells.reserve_exact(lines * n);
        let mut cells = vec![Cell::default(); n];
        let mut extras: Vec<(String, Cell)> = Vec::new();
        let mut start = 0usize;
        let mut number = 0u32;
        while start <= bytes.len() {
            let end = bytes[start..].iter().position(|b| *b == b'\n').map_or(bytes.len(), |i| start + i);
            let line = &bytes[start..end];
            let at = (start as u32, (end - start) as u32);
            start = end + 1;
            let this = number;
            number += 1;
            if blank(line) {
                continue;
            }
            let rows_before = self.rows.len() as u32;
            let refused = |is| Line { file, line: this, is, rows_before, start: at.0, len: at.1 };
            cells.iter_mut().for_each(|c| *c = Cell::default());
            extras.clear();
            let mut id: Option<Cell> = None;
            let read = {
                let mut de = serde_json::Deserializer::from_slice(line);
                let got = de.deserialize_any(RowVisitor { line, by_name: &self.by_name, cells: &mut cells, extras: &mut extras, id: &mut id });
                got.and_then(|is_row| de.end().map(|()| is_row))
            };
            match read {
                Err(_) => self.lines.push(refused(LineIs::NotJson)),
                Ok(false) => self.lines.push(refused(LineIs::NotRow)),
                Ok(true) => {
                    let id_text = id.and_then(|c| {
                        let raw = &line[c.start as usize..(c.start + c.len) as usize];
                        match c.kind {
                            kind::TEXT => std::str::from_utf8(raw).ok().map(str::to_string),
                            kind::ESCAPED => serde_json::from_slice::<String>(&line[c.start as usize - 1..(c.start + c.len) as usize + 1]).ok(),
                            _ => None,
                        }
                    });
                    let Some(id_text) = id_text.filter(|t| !t.is_empty()) else {
                        self.lines.push(refused(LineIs::NoId));
                        continue;
                    };
                    let row = self.rows.len() as u32;
                    if let Some(first) = self.take_id(&id_text, row, (file, &bytes)) {
                        self.lines.push(refused(LineIs::Repeat(first)));
                        continue;
                    }
                    self.rows.push(RowAt { file, start: at.0, len: at.1 });
                    self.ids.push(id.unwrap_or_default());
                    self.cells.extend_from_slice(&cells);
                    self.extras.extend(extras.drain(..).map(|(key, value)| Extra { row, key, value }));
                }
            }
        }
        debug_assert_eq!(self.cells.len(), self.rows.len() * n);
        self.files.push((name.to_string(), bytes));
        // What the lines that weren't rows reserved.
        self.rows.shrink_to_fit();
        self.ids.shrink_to_fit();
        self.cells.shrink_to_fit();
        self.rows.len() - before
    }
}

/// Reads one line: true when it's an object (a row), false when it's JSON of
/// another kind; an error when it isn't JSON.
struct RowVisitor<'v, 'de> {
    line: &'de [u8],
    by_name: &'v HashMap<String, usize>,
    cells: &'v mut [Cell],
    extras: &'v mut Vec<(String, Cell)>,
    id: &'v mut Option<Cell>,
}

impl<'v, 'de> Visitor<'de> for RowVisitor<'v, 'de> {
    type Value = bool;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("JSON")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<bool, A::Error> {
        while let Some(Key(name)) = map.next_key::<Key<'de>>()? {
            let value: &'de RawValue = map.next_value()?;
            let value_cell = cell_of(self.line, value);
            // A key written twice is the last one's, as JSON.parse reads it.
            if name == "id" {
                *self.id = Some(value_cell);
            } else if let Some(&f) = self.by_name.get(&*name) {
                self.cells[f] = value_cell;
            } else if let Some(kept) = self.extras.iter_mut().find(|(k, _)| *k == *name) {
                kept.1 = value_cell;
            } else {
                self.extras.push((name.into_owned(), value_cell));
            }
        }
        Ok(true)
    }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<bool, A::Error> {
        while seq.next_element::<serde::de::IgnoredAny>()?.is_some() {}
        Ok(false)
    }
    fn visit_bool<E>(self, _: bool) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_i64<E>(self, _: i64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_u64<E>(self, _: u64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_f64<E>(self, _: f64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_str<E>(self, _: &str) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_unit<E>(self) -> Result<bool, E> {
        Ok(false)
    }
}

/// A key: borrowed from the line when nothing in it is escaped.
struct Key<'de>(std::borrow::Cow<'de, str>);

impl<'de> serde::Deserialize<'de> for Key<'de> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Key<'de>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a key")
            }
            fn visit_borrowed_str<E>(self, s: &'de str) -> Result<Key<'de>, E> {
                Ok(Key(std::borrow::Cow::Borrowed(s)))
            }
            fn visit_str<E>(self, s: &str) -> Result<Key<'de>, E> {
                Ok(Key(std::borrow::Cow::Owned(s.to_string())))
            }
            fn visit_string<E>(self, s: String) -> Result<Key<'de>, E> {
                Ok(Key(std::borrow::Cow::Owned(s)))
            }
        }
        d.deserialize_str(V)
    }
}

/// CRC-32 (IEEE), as zip writes it.
pub fn crc32(bytes: &[u8]) -> u32 {
    crc32fast::hash(bytes)
}

/// A zip entry's bytes as the archive holds them, inflated (method 8) or as
/// stored (method 0), checked against the size and CRC-32 it declares.
pub fn inflate(name: &str, method: u32, raw: &[u8], size: usize, crc: u32) -> Result<Vec<u8>, String> {
    let bytes = match method {
        0 => raw.to_vec(),
        8 => {
            // Into exactly the size it declares: inflating into a growing list would hold up to twice it.
            let mut out = vec![0u8; size];
            let made = miniz_oxide::inflate::decompress_slice_iter_to_slice(&mut out, std::iter::once(raw), false, true).map_err(|_| format!("corrupt zip: can't inflate {name}"))?;
            if made != size {
                return Err(format!("corrupt zip: size mismatch for {name}"));
            }
            out
        }
        m => return Err(format!("unsupported zip compression method {m} for {name}")),
    };
    if bytes.len() != size {
        return Err(format!("corrupt zip: size mismatch for {name}"));
    }
    if crc32(&bytes) != crc {
        return Err(format!("corrupt zip: CRC mismatch for {name}"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(text: &str) -> Rows {
        let mut r = Rows::new(&["t".into(), "n".into()]);
        r.read("rows/0001.ndjson", text.as_bytes().to_vec(), true);
        r
    }

    #[test]
    fn rows_are_spans_of_their_lines() {
        let r = rows("{\"id\":\"a\", \"t\":\"x\\\"y\",\"n\":1.50,\"z\":[1, 2]}\n{\"n\":2,\"id\":\"b\"}\n");
        assert_eq!(r.len(), 2);
        assert_eq!(r.line(0), b"{\"id\":\"a\", \"t\":\"x\\\"y\",\"n\":1.50,\"z\":[1, 2]}");
        assert_eq!((r.id(0), r.id(1)), ("a".to_string(), "b".to_string()));
        let c = r.cells(0);
        assert_eq!(r.text(0, c[0]).as_deref(), Some("x\"y"));
        assert_eq!((c[1].kind, r.raw(0, c[1])), (kind::NUMBER, &b"1.50"[..]));
        let e = r.extras(0);
        assert_eq!((e[0].key.as_str(), r.raw(0, e[0].value)), ("z", &b"[1, 2]"[..]));
        assert_eq!(r.cells(1)[0].kind, kind::ABSENT);
        assert!(r.extras(1).is_empty());
        assert_eq!(r.row_of("b"), Some(1));
    }

    #[test]
    fn lines_that_arent_rows_are_kept_with_why() {
        let r = rows("{\"id\":\"a\"}\nnot json\n[1]\n{\"t\":\"x\"}\n{\"id\":\"\"}\n  \u{a0}\n{\"id\":\"a\",\"t\":\"again\"}\n{\"id\":\"b\"}");
        let is: Vec<_> = r.lines().iter().map(|l| (l.line, l.is, l.rows_before)).collect();
        assert_eq!(is, vec![(1, LineIs::NotJson, 1), (2, LineIs::NotRow, 1), (3, LineIs::NoId, 1), (4, LineIs::NoId, 1), (6, LineIs::Repeat(0), 1)]);
        assert_eq!(r.unread(&r.lines()[0]), b"not json");
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn a_key_written_twice_is_the_last_ones() {
        let r = rows("{\"id\":\"a\",\"t\":\"one\",\"t\":\"two\",\"q\":1,\"q\":2}");
        assert_eq!(r.text(0, r.cells(0)[0]).as_deref(), Some("two"));
        assert_eq!(r.extras(0).len(), 1);
        assert_eq!(r.raw(0, r.extras(0)[0].value), b"2");
    }

    #[test]
    fn text_as_text_decoder_reads_it() {
        let mut r = Rows::new(&[]);
        r.read("a", b"\xef\xbb\xbf{\"id\":\"a\"}\n{\"id\":\"b\xff\"}".to_vec(), true);
        assert_eq!((r.id(0), r.id(1)), ("a".to_string(), "b\u{fffd}".to_string()));
        let mut kept = Rows::new(&[]);
        kept.read("a", b"\xef\xbb\xbf{\"id\":\"a\"}".to_vec(), false);
        assert_eq!(kept.lines()[0].is, LineIs::NotJson);
    }

    #[test]
    fn zip_entries_are_checked() {
        let data = b"hello rows".to_vec();
        let deflated = miniz_oxide::deflate::compress_to_vec(&data, 6);
        assert_eq!(inflate("x", 8, &deflated, data.len(), crc32(&data)).unwrap(), data);
        assert_eq!(inflate("x", 0, &data, data.len(), crc32(&data)).unwrap(), data);
        assert!(inflate("x", 8, &deflated, data.len(), 1).unwrap_err().contains("CRC mismatch"));
        assert!(inflate("x", 0, &data, 3, crc32(&data)).unwrap_err().contains("size mismatch"));
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }
}
