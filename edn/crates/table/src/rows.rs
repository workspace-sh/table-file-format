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

/// Where a row's line is: in a rows file as read, or (`file` EDITS) among the lines edits wrote.
#[derive(Clone, Copy, Debug)]
struct RowAt {
    file: u32,
    start: u32,
    len: u32,
}

/// The `file` of a row whose line an edit wrote.
const EDITS: u32 = u32::MAX;

/// A table's rows, held by the engine.
///
/// Each row is a slot: its line, its id and its cells, made once and never changed. Slots are
/// only ever added, so an edit (step 3) writes the row it changes as a new slot, and a row
/// removed keeps its slot until the table is let go. A row's place in the table is its place in
/// `order`; until an edit adds, removes or moves a row there's no `order`, and a row's place is its
/// slot. Everything outside this file names rows by place.
pub struct Rows {
    names: Vec<String>,
    by_name: HashMap<String, usize>,
    files: Vec<(String, Vec<u8>)>,
    /// By slot.
    rows: Vec<RowAt>,
    /// By slot.
    ids: Vec<Cell>,
    /// Slot-major: `slots × names`.
    cells: Vec<Cell>,
    /// By slot, in slot order.
    extras: Vec<Extra>,
    lines: Vec<Line>,
    /// A live row's slot, by its id.
    by_id: HashMap<u64, u32>,
    by_id_rest: HashMap<Box<[u8]>, u32>,
    /// Slots by place, once an edit has added, removed or moved a row.
    order: Option<Vec<u32>>,
    /// Places by slot (`DEAD` for a row that isn't in the table), made again when `order` changes.
    places: Vec<u32>,
    places_made: bool,
    /// The first place whose row's place may be out of date, when they aren't made.
    places_from: usize,
    /// The lines edits wrote.
    edits: Vec<u8>,
    /// The slot as read of each row an edit wrote: what its line is written from, so values
    /// nobody changed keep their bytes.
    origin: HashMap<u32, u32>,
    /// Rows an edit took out, by id: the slot each was last, so one put back as it was is its line as it was.
    gone: HashMap<Box<str>, u32>,
    /// While an edit is under way: each id it pointed elsewhere, and the slot it was (`mark`);
    /// and each it set as gone, and what it was.
    id_log: Option<Vec<(Box<str>, Option<u32>)>>,
    gone_log: Vec<(Box<str>, Option<u32>)>,
    /// And each change to `order`, to undo in turn.
    order_log: Vec<OrderStep>,
    /// Rows written over in their own slot (`overwrite`): where each line was as read.
    read_at: HashMap<u32, RowAt>,
    /// While an edit is under way: each slot it wrote over, as it was.
    slot_log: Vec<(u32, RowAt, Cell, Vec<Cell>, bool)>,
    /// The rows file of each row put back with other values than it was taken out with (`set_home`):
    /// written back where it was read, as a row of that id always is.
    home: HashMap<u32, u32>,
}

/// A change to `order`, as `undo_to` undoes it.
enum OrderStep {
    Replaced(u32, u32),
    Inserted(u32),
    /// Rows put in together at a place: how many.
    InsertedMany(u32, u32),
    Removed(u32, u32),
}

/// A slot whose row isn't in the table.
pub const DEAD: u32 = u32::MAX;

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
            order: None,
            places: Vec::new(),
            places_made: true,
            places_from: usize::MAX,
            edits: Vec::new(),
            origin: HashMap::new(),
            gone: HashMap::new(),
            id_log: None,
            gone_log: Vec::new(),
            order_log: Vec::new(),
            read_at: HashMap::new(),
            slot_log: Vec::new(),
            home: HashMap::new(),
        }
    }

    /// How many rows the table has.
    pub fn len(&self) -> usize {
        self.order.as_ref().map_or(self.rows.len(), Vec::len)
    }

    /// A row's slot, by its place.
    #[inline]
    pub fn slot(&self, row: usize) -> usize {
        match &self.order {
            None => row,
            Some(o) => o[row] as usize,
        }
    }

    /// The bytes of the files read, given back for another use: the rows are let go.
    pub fn into_bytes(self) -> Vec<Vec<u8>> {
        self.files.into_iter().map(|(_, b)| b).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
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
            + self.edits.capacity()
            + (self.order.as_ref().map_or(0, Vec::capacity) + self.places.capacity()) * 4
    }

    /// A row's line: as read, or as an edit wrote it.
    pub fn line(&self, row: usize) -> &[u8] {
        self.slot_line(self.slot(row))
    }

    /// A slot's line.
    pub fn slot_line(&self, slot: usize) -> &[u8] {
        let r = self.rows[slot];
        let bytes = if r.file == EDITS { &self.edits } else { &self.files[r.file as usize].1 };
        &bytes[r.start as usize..(r.start + r.len) as usize]
    }

    /// A line that isn't a row, as read.
    pub fn unread(&self, l: &Line) -> &[u8] {
        &self.files[l.file as usize].1[l.start as usize..(l.start + l.len) as usize]
    }

    /// A row's id.
    pub fn id(&self, row: usize) -> String {
        self.slot_id(self.slot(row))
    }

    /// A slot's id.
    pub fn slot_id(&self, slot: usize) -> String {
        let c = self.ids[slot];
        let line = self.slot_line(slot);
        match c.kind {
            kind::TEXT => String::from_utf8_lossy(&line[c.start as usize..(c.start + c.len) as usize]).into_owned(),
            kind::ESCAPED => serde_json::from_slice(&line[c.start as usize - 1..(c.start + c.len) as usize + 1]).unwrap_or_default(),
            _ => String::new(),
        }
    }

    /// The schema field a name is, if it's one.
    pub fn field(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }

    /// A key's cell in a row: a schema field's, the id, or a key the schema doesn't name.
    pub fn cell_named(&self, row: usize, field: Option<usize>, name: &str) -> Cell {
        match field {
            Some(f) => self.cells(row)[f],
            None if name == "id" => self.ids[self.slot(row)],
            None => self.extras(row).iter().find(|e| e.key == name).map_or(Cell::default(), |e| e.value),
        }
    }

    /// Whether any row has a key the schema doesn't name by this name.
    pub fn has_extra(&self, name: &str) -> bool {
        self.extras.iter().any(|e| e.key == name && self.live(e.row as usize))
    }

    /// Whether a slot's row is in the table.
    fn live(&self, slot: usize) -> bool {
        match &self.order {
            None => true,
            Some(_) => self.places.get(slot).is_some_and(|&p| p != DEAD),
        }
    }

    /// Where a row's id is in its line.
    pub fn id_cell(&self, row: usize) -> Cell {
        self.ids[self.slot(row)]
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
        self.slot_cells(self.slot(row))
    }

    /// A slot's cells, in the schema's order.
    pub fn slot_cells(&self, slot: usize) -> &[Cell] {
        let n = self.names.len();
        &self.cells[slot * n..(slot + 1) * n]
    }

    /// The keys the schema doesn't name, in a row.
    pub fn extras(&self, row: usize) -> &[Extra] {
        self.slot_extras(self.slot(row))
    }

    /// The keys the schema doesn't name, in a slot.
    pub fn slot_extras(&self, slot: usize) -> &[Extra] {
        let row = slot as u32;
        let from = self.extras.partition_point(|e| e.row < row);
        let to = self.extras.partition_point(|e| e.row <= row);
        &self.extras[from..to]
    }

    /// The row an id is, if any.
    pub fn row_of(&self, id: &str) -> Option<usize> {
        let slot = self.slot_of(id)?;
        match &self.order {
            None => Some(slot),
            Some(_) => {
                debug_assert!(self.places_made, "places are made at the end of every edit");
                self.places.get(slot).filter(|&&p| p != DEAD).map(|&p| p as usize)
            }
        }
    }

    /// The slot of the row an id is, if any.
    pub fn slot_of(&self, id: &str) -> Option<usize> {
        let found = match self.by_id.get(&hash(id.as_bytes())) {
            Some(&r) if self.slot_id(r as usize) == id => Some(r),
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

    /// Reads one rows file, as text (`bytes`, a file's bytes in UTF-8), within the default limits.
    /// `strip_bom`: a byte order mark at its start isn't part of its first line (as a reader that
    /// decodes it with `TextDecoder` reads it). Text that isn't UTF-8 is read with U+FFFD in its
    /// place, as `TextDecoder` reads it. Returns how many rows it held.
    pub fn read(&mut self, name: &str, bytes: Vec<u8>, strip_bom: bool) -> Result<usize, String> {
        self.read_within(name, bytes, strip_bom, Limits::default())
    }

    /// `read`, refusing a file or a table past `limits`. A file comes from anyone (another
    /// device, over P2P), so what's too large to hold is an error, never an abort: nothing here
    /// allocates on what a file says without asking first. Refused, the table is as it was.
    pub fn read_within(&mut self, name: &str, bytes: Vec<u8>, strip_bom: bool, limits: Limits) -> Result<usize, String> {
        if self.order.is_some() || !self.edits.is_empty() {
            return Err(format!("{name} can't be read into a table that has been edited"));
        }
        let mut bytes = lossy(bytes)?;
        if strip_bom && bytes.starts_with("\u{feff}".as_bytes()) {
            bytes.drain(..3);
        }
        if bytes.len() > limits.max_file {
            return Err(format!("{name} is too large to read: {} bytes, past {}", bytes.len(), limits.max_file));
        }
        let before = (self.rows.len(), self.cells.len(), self.extras.len(), self.lines.len());
        let read = self.read_lines(name, &bytes, &limits);
        if let Err(e) = read {
            self.undo(before, &bytes);
            return Err(e);
        }
        if self.files.try_reserve(1).is_err() {
            self.undo(before, &bytes);
            return Err(format!("{name} is too large to hold"));
        }
        self.files.push((name.to_string(), bytes));
        // What the lines that weren't rows reserved.
        self.rows.shrink_to_fit();
        self.ids.shrink_to_fit();
        self.cells.shrink_to_fit();
        Ok(self.rows.len() - before.0)
    }

    /// Puts the table back as it was before a file that was refused: `before` is its lists' lengths then.
    fn undo(&mut self, before: (usize, usize, usize, usize), reading: &[u8]) {
        let file = self.files.len() as u32;
        for row in (before.0..self.rows.len()).rev() {
            if let Some(id) = self.id_reading(row, (file, reading)) {
                let h = hash(id.as_bytes());
                if self.by_id.get(&h) == Some(&(row as u32)) {
                    self.by_id.remove(&h);
                }
                self.by_id_rest.remove(id.as_bytes());
            }
        }
        self.rows.truncate(before.0);
        self.ids.truncate(before.0);
        self.cells.truncate(before.1);
        self.extras.truncate(before.2);
        self.lines.truncate(before.3);
    }

    fn read_lines(&mut self, name: &str, bytes: &[u8], limits: &Limits) -> Result<(), String> {
        let too_large = || format!("{name} is too large to hold");
        let file = self.files.len() as u32;
        let n = self.names.len();
        // At most a row a line: reserved once when it can be, so the lists don't grow to twice what they hold.
        let lines = bytes.iter().filter(|b| **b == b'\n').count() + 1;
        let _ = self.rows.try_reserve_exact(lines);
        let _ = self.ids.try_reserve_exact(lines);
        let _ = lines.checked_mul(n).map(|c| self.cells.try_reserve_exact(c));
        let mut cells = vec![Cell::default(); n];
        let mut extras: Vec<(String, Cell)> = Vec::new();
        let mut seen_extras: HashMap<String, usize> = HashMap::new();
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
            seen_extras.clear();
            let mut id: Option<Cell> = None;
            let read = {
                let mut de = serde_json::Deserializer::from_slice(line);
                let got = de.deserialize_any(RowVisitor { line, by_name: &self.by_name, cells: &mut cells, extras: &mut extras, seen_extras: &mut seen_extras, id: &mut id });
                got.and_then(|is_row| de.end().map(|()| is_row))
            };
            match read {
                Err(_) => keep(&mut self.lines, refused(LineIs::NotJson), name)?,
                Ok(false) => keep(&mut self.lines, refused(LineIs::NotRow), name)?,
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
                        keep(&mut self.lines, refused(LineIs::NoId), name)?;
                        continue;
                    };
                    if self.rows.len() >= limits.max_rows {
                        return Err(format!("{name} holds more rows than a table can: {}", limits.max_rows));
                    }
                    let row = self.rows.len() as u32;
                    if let Some(first) = self.take_id(&id_text, row, (file, bytes)) {
                        keep(&mut self.lines, refused(LineIs::Repeat(first)), name)?;
                        continue;
                    }
                    self.rows.try_reserve(1).map_err(|_| too_large())?;
                    self.ids.try_reserve(1).map_err(|_| too_large())?;
                    self.cells.try_reserve(n).map_err(|_| too_large())?;
                    self.extras.try_reserve(extras.len()).map_err(|_| too_large())?;
                    self.rows.push(RowAt { file, start: at.0, len: at.1 });
                    self.ids.push(id.unwrap_or_default());
                    self.cells.extend_from_slice(&cells);
                    self.extras.extend(extras.drain(..).map(|(key, value)| Extra { row, key, value }));
                }
            }
        }
        debug_assert_eq!(self.cells.len(), self.rows.len() * n);
        Ok(())
    }
}

/// What an edit changes in the rows, a step at a time (`edit.rs` decides which steps).
impl Rows {
    /// How many slots there are: rows as read, and rows edits wrote.
    pub fn slots(&self) -> usize {
        self.rows.len()
    }

    /// The slot a row an edit wrote was written from: the row as read, or the row as inserted.
    pub fn origin_of(&self, slot: usize) -> usize {
        self.origin.get(&(slot as u32)).map_or(slot, |&o| o as usize)
    }

    /// The rows file a slot's row was read from, by its place among the files read: an edited row's
    /// is its row as read's; a row an edit put in has none.
    pub fn home_file(&self, slot: usize) -> Option<usize> {
        let origin = self.origin_of(slot);
        if let Some(&f) = self.home.get(&(origin as u32)) {
            return Some(f as usize);
        }
        let at = match self.read_at.get(&(slot as u32)) {
            Some(r) => *r,
            None => self.rows[origin],
        };
        (at.file != EDITS).then_some(at.file as usize)
    }

    /// A row put back in a new slot, with other values than its last (`gone`): its rows file is that one's.
    pub fn set_home(&mut self, slot: usize, was: usize) {
        if let Some(f) = self.home_file(was) {
            self.home.insert(slot as u32, f as u32);
        }
    }

    /// How many rows files were read.
    pub fn files_read(&self) -> usize {
        self.files.len()
    }

    /// How many bytes a rows file was read as.
    pub fn file_len(&self, file: usize) -> usize {
        self.files[file].1.len()
    }

    /// Where a slot's line's bytes are, as one number: its file read (or the lines edits wrote), and
    /// where in it. Bytes are only added, so the same place is the same bytes.
    pub fn slot_place(&self, slot: usize) -> u64 {
        let r = self.rows[slot];
        (u64::from(r.file) << 32) | u64::from(r.start)
    }

    /// Where a slot's line is in the rows file it was read from, as (file, start, length): none for a
    /// line an edit wrote.
    pub fn slot_at(&self, slot: usize) -> Option<(usize, usize, usize)> {
        let r = self.rows[slot];
        (r.file != EDITS).then_some((r.file as usize, r.start as usize, r.len as usize))
    }

    /// The line a row an edit wrote was written from, as read (or as inserted).
    pub fn origin_line(&self, slot: usize) -> &[u8] {
        match self.read_at.get(&(slot as u32)) {
            Some(r) => &self.files[r.file as usize].1[r.start as usize..(r.start + r.len) as usize],
            None => self.slot_line(self.origin_of(slot)),
        }
    }

    /// Whether rows are still in their slots' order: no row added, removed or moved.
    pub fn in_slot_order(&self) -> bool {
        self.order.is_none()
    }

    /// A row's line written over in its own slot, as long as the rows are in their slots' order
    /// and neither line has a key the schema doesn't name: so an edit to a cell needs no order
    /// (one for a million rows is 4 MB). `as_read`: the line is the row's as read. False, and
    /// nothing done, when it can't be.
    pub fn overwrite(&mut self, slot: usize, line: &[u8], as_read: bool) -> Result<bool, String> {
        if self.order.is_some() || !self.slot_extras(slot).is_empty() {
            return Ok(false);
        }
        let n = self.names.len();
        let mut cells = vec![Cell::default(); n];
        let mut extras: Vec<(String, Cell)> = Vec::new();
        let mut seen_extras: HashMap<String, usize> = HashMap::new();
        let mut id: Option<Cell> = None;
        let read = {
            let mut de = serde_json::Deserializer::from_slice(line);
            let got = de.deserialize_any(RowVisitor { line, by_name: &self.by_name, cells: &mut cells, extras: &mut extras, seen_extras: &mut seen_extras, id: &mut id });
            got.and_then(|is_row| de.end().map(|()| is_row))
        };
        if !matches!(read, Ok(true)) || !extras.is_empty() || !id.is_some_and(|c| matches!(c.kind, kind::TEXT | kind::ESCAPED)) {
            return Ok(false);
        }
        let was = self.rows[slot];
        let at = if as_read {
            match self.read_at.get(&(slot as u32)) {
                Some(&r) => r,
                None => return Ok(false),
            }
        } else {
            if self.edits.len() + line.len() > u32::MAX as usize {
                return Err("the table is too large to edit".into());
            }
            self.edits.try_reserve(line.len()).map_err(|_| "the table is too large to edit".to_string())?;
            let start = self.edits.len() as u32;
            self.edits.extend_from_slice(line);
            RowAt { file: EDITS, start, len: line.len() as u32 }
        };
        let first = !self.read_at.contains_key(&(slot as u32));
        if self.id_log.is_some() {
            self.slot_log.push((slot as u32, was, self.ids[slot], self.slot_cells(slot).to_vec(), first));
        }
        if first {
            self.read_at.insert(slot as u32, was);
        }
        self.rows[slot] = at;
        self.ids[slot] = id.expect("checked");
        self.cells[slot * n..(slot + 1) * n].copy_from_slice(&cells);
        Ok(true)
    }

    fn ensure_order(&mut self) {
        if self.order.is_none() {
            // Room for some rows more, so the first ones added don't make either again.
            let n = self.rows.len();
            let room = n + n / 16 + 16;
            let mut order = Vec::with_capacity(room);
            order.extend(0..n as u32);
            let mut places = Vec::with_capacity(room);
            places.extend(0..n as u32);
            self.order = Some(order);
            self.places = places;
            self.places_made = true;
            self.places_from = usize::MAX;
        }
    }

    /// A slot's place in the table, if its row is in it.
    pub fn place_of(&mut self, slot: usize) -> Option<usize> {
        if self.order.is_none() {
            return (slot < self.rows.len()).then_some(slot);
        }
        self.make_places();
        self.places.get(slot).filter(|&&p| p != DEAD).map(|&p| p as usize)
    }

    /// Places made again after rows were added, removed or moved.
    pub fn make_places(&mut self) {
        if self.places_made {
            return;
        }
        let order = self.order.as_ref().expect("places are only unmade with an order");
        // Rows before the first place changed are where they were: only those from it on move.
        if self.places.len() < self.rows.len() {
            self.places.resize(self.rows.len(), DEAD);
        }
        let from = self.places_from.min(order.len());
        for (at, &slot) in order.iter().enumerate().skip(from) {
            self.places[slot as usize] = at as u32;
        }
        self.places_from = usize::MAX;
        self.places_made = true;
    }

    /// A line an edit wrote, held as a new slot (not yet in the table): `origin`, the slot it was
    /// written from. An error, and nothing held, when it isn't a row with an id.
    pub fn push_line(&mut self, line: &[u8], origin: Option<usize>) -> Result<usize, String> {
        let too_large = || "the table is too large to edit".to_string();
        if self.rows.len() >= u32::MAX as usize - 1 || self.edits.len() + line.len() > u32::MAX as usize {
            return Err(too_large());
        }
        let n = self.names.len();
        let mut cells = vec![Cell::default(); n];
        let mut extras: Vec<(String, Cell)> = Vec::new();
        let mut seen_extras: HashMap<String, usize> = HashMap::new();
        let mut id: Option<Cell> = None;
        let read = {
            let mut de = serde_json::Deserializer::from_slice(line);
            let got = de.deserialize_any(RowVisitor { line, by_name: &self.by_name, cells: &mut cells, extras: &mut extras, seen_extras: &mut seen_extras, id: &mut id });
            got.and_then(|is_row| de.end().map(|()| is_row))
        };
        if !matches!(read, Ok(true)) || !id.is_some_and(|c| matches!(c.kind, kind::TEXT | kind::ESCAPED)) {
            return Err("an edit wrote a line that isn't a row with an id".into());
        }
        // Room for a sixteenth more of the table at a time, not twice it: the first edit after a
        // table is read would otherwise reserve as much again as it holds (72 MB of cells for a
        // million rows of eight fields).
        let more = (self.rows.len() / 16).max(64);
        grow(&mut self.edits, line.len(), more * 64).map_err(|_| too_large())?;
        grow(&mut self.rows, 1, more).map_err(|_| too_large())?;
        grow(&mut self.ids, 1, more).map_err(|_| too_large())?;
        grow(&mut self.cells, n, more * n).map_err(|_| too_large())?;
        grow(&mut self.extras, extras.len(), extras.len()).map_err(|_| too_large())?;
        self.ensure_order();
        grow(&mut self.places, 1, more).map_err(|_| too_large())?;
        let slot = self.rows.len() as u32;
        let start = self.edits.len() as u32;
        self.edits.extend_from_slice(line);
        self.rows.push(RowAt { file: EDITS, start, len: line.len() as u32 });
        self.ids.push(id.unwrap_or_default());
        self.cells.extend_from_slice(&cells);
        self.extras.extend(extras.into_iter().map(|(key, value)| Extra { row: slot, key, value }));
        self.places.push(DEAD);
        if let Some(o) = origin {
            // Written over in its slot before: its line as read is where that one's is.
            if let Some(&r) = self.read_at.get(&(o as u32)) {
                self.read_at.insert(slot, r);
            }
            let o = self.origin_of(o) as u32;
            self.origin.insert(slot, o);
        }
        Ok(slot as usize)
    }

    /// The row an id is, as a slot, set (or, with None, the id named no row).
    pub fn set_slot_of(&mut self, id: &str, slot: Option<usize>) {
        let was = self.slot_of(id).map(|s| s as u32);
        if let Some(log) = self.id_log.as_mut() {
            log.push((id.into(), was));
        }
        self.point(id, slot);
    }

    fn point(&mut self, id: &str, slot: Option<usize>) {
        let h = hash(id.as_bytes());
        let first = self.by_id.get(&h).copied().filter(|&r| self.slot_id(r as usize) == id);
        match (first, slot) {
            (Some(_), Some(s)) => {
                self.by_id.insert(h, s as u32);
            }
            (Some(_), None) => {
                self.by_id.remove(&h);
            }
            (None, Some(s)) => {
                if self.by_id_rest.contains_key(id.as_bytes()) || self.by_id.contains_key(&h) {
                    self.by_id_rest.insert(id.as_bytes().into(), s as u32);
                } else {
                    self.by_id.insert(h, s as u32);
                }
            }
            (None, None) => {
                self.by_id_rest.remove(id.as_bytes());
            }
        }
    }

    /// The slot a row taken out by an edit was last, if it hasn't been put back.
    pub fn gone_slot(&self, id: &str) -> Option<usize> {
        self.gone.get(id).map(|&s| s as usize)
    }

    /// A row taken out (Some, its slot), or put back (None).
    pub fn set_gone(&mut self, id: &str, slot: Option<usize>) {
        let was = match slot {
            Some(s) => self.gone.insert(id.into(), s as u32),
            None => self.gone.remove(id),
        };
        if self.id_log.is_some() {
            self.gone_log.push((id.into(), was));
        }
    }

    /// The row at a place is now the one in `slot`.
    pub fn replace_place(&mut self, at: usize, slot: usize) {
        self.ensure_order();
        // Places made first: an entry left as it was before the first changed place would be wrong after.
        self.make_places();
        let order = self.order.as_mut().expect("made");
        let old = std::mem::replace(&mut order[at], slot as u32) as usize;
        if self.id_log.is_some() {
            self.order_log.push(OrderStep::Replaced(at as u32, old as u32));
        }
        if self.places_made {
            self.places[old] = DEAD;
            self.places[slot] = at as u32;
        }
    }

    /// A row put in at a place, those from there on one further along.
    pub fn insert_place(&mut self, at: usize, slot: usize) -> Result<(), String> {
        self.ensure_order();
        let order = self.order.as_mut().expect("made");
        let step = (order.len() / 16).max(64);
        grow(order, 1, step).map_err(|_| "the table is too large to edit".to_string())?;
        order.insert(at, slot as u32);
        if self.id_log.is_some() {
            self.order_log.push(OrderStep::Inserted(at as u32));
        }
        self.places_made = false;
        self.places_from = self.places_from.min(at);
        Ok(())
    }

    /// Rows put in together at a place, in this order: a paste, one move of the rows after them.
    pub fn insert_places(&mut self, at: usize, slots: &[usize]) -> Result<(), String> {
        self.ensure_order();
        let order = self.order.as_mut().expect("made");
        let step = (order.len() / 16).max(slots.len());
        grow(order, slots.len(), step).map_err(|_| "the table is too large to edit".to_string())?;
        order.splice(at..at, slots.iter().map(|&s| s as u32));
        if self.id_log.is_some() {
            self.order_log.push(OrderStep::InsertedMany(at as u32, slots.len() as u32));
        }
        self.places_made = false;
        self.places_from = self.places_from.min(at);
        Ok(())
    }

    /// The row at a place taken out of the table: its slot.
    pub fn remove_place(&mut self, at: usize) -> usize {
        self.ensure_order();
        let slot = self.order.as_mut().expect("made").remove(at) as usize;
        if self.id_log.is_some() {
            self.order_log.push(OrderStep::Removed(at as u32, slot as u32));
        }
        if let Some(p) = self.places.get_mut(slot) {
            *p = DEAD;
        }
        self.places_made = false;
        self.places_from = self.places_from.min(at);
        slot
    }

    /// What `undo_to` puts the rows back to.
    /// Until `commit` or `undo_to`, what changes is kept to undo.
    pub fn mark(&mut self) -> Mark {
        self.id_log = Some(Vec::new());
        self.gone_log.clear();
        self.order_log.clear();
        self.slot_log.clear();
        Mark { slots: self.rows.len(), edits: self.edits.len(), extras: self.extras.len(), ordered: self.order.is_some() }
    }

    /// The edit since the mark stands.
    pub fn commit(&mut self, _m: Mark) {
        self.id_log = None;
        self.gone_log.clear();
        self.order_log.clear();
        self.slot_log.clear();
        if self.order.is_some() {
            self.make_places();
        }
    }

    /// The rows as they were at a mark: an edit the engine couldn't finish changes nothing.
    pub fn undo_to(&mut self, m: Mark) {
        let n = self.names.len();
        // Rows written over in their slots, as they were (their lines are still here).
        for (slot, at, id, cells, first) in std::mem::take(&mut self.slot_log).into_iter().rev() {
            let s = slot as usize;
            self.rows[s] = at;
            self.ids[s] = id;
            self.cells[s * n..(s + 1) * n].copy_from_slice(&cells);
            if first {
                self.read_at.remove(&slot);
            }
        }
        // Ids next, while every slot they name is still here to read.
        for (id, was) in self.id_log.take().unwrap_or_default().into_iter().rev() {
            self.point(&id, was.map(|s| s as usize));
        }
        for (id, was) in std::mem::take(&mut self.gone_log).into_iter().rev() {
            match was {
                Some(s) => self.gone.insert(id, s),
                None => self.gone.remove(&id),
            };
        }
        for s in m.slots..self.rows.len() {
            self.origin.remove(&(s as u32));
            self.read_at.remove(&(s as u32));
            self.home.remove(&(s as u32));
        }
        self.rows.truncate(m.slots);
        self.ids.truncate(m.slots);
        self.cells.truncate(m.slots * n);
        self.extras.truncate(m.extras);
        self.edits.truncate(m.edits);
        if let Some(order) = self.order.as_mut() {
            for step in std::mem::take(&mut self.order_log).into_iter().rev() {
                match step {
                    OrderStep::Replaced(at, old) => order[at as usize] = old,
                    OrderStep::Inserted(at) => {
                        order.remove(at as usize);
                    }
                    OrderStep::InsertedMany(at, n) => {
                        order.drain(at as usize..(at + n) as usize);
                    }
                    OrderStep::Removed(at, slot) => order.insert(at as usize, slot),
                }
            }
        }
        if !m.ordered {
            self.order = None;
        }
        self.places_made = self.order.is_none();
        self.places.clear();
        self.places_from = 0;
        if self.order.is_some() {
            self.make_places();
        }
    }
}

/// The rows as they were before an edit, to go back to if it can't be finished.
pub struct Mark {
    slots: usize,
    edits: usize,
    extras: usize,
    ordered: bool,
}

/// Room in `v` for `need` more, adding `step` at a time (at least `need`) when there isn't.
fn grow<T>(v: &mut Vec<T>, need: usize, step: usize) -> Result<(), std::collections::TryReserveError> {
    if v.capacity() - v.len() >= need {
        return Ok(());
    }
    v.try_reserve_exact(step.max(need))
}

/// Keeps a line that isn't a row, or says the file is too large to.
fn keep(lines: &mut Vec<Line>, l: Line, name: &str) -> Result<(), String> {
    lines.try_reserve(1).map_err(|_| format!("{name} is too large to hold"))?;
    lines.push(l);
    Ok(())
}

/// What a held table refuses to go past.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// The bytes of one rows file, once inflated. Spans are 32-bit, so never more than 4 GiB.
    pub max_file: usize,
    /// The rows of one table.
    pub max_rows: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_file: u32::MAX as usize - 1, max_rows: u32::MAX as usize - 1 }
    }
}

/// `bytes` as UTF-8, each sequence that isn't replaced by U+FFFD as `TextDecoder` (and
/// `String::from_utf8_lossy`) replaces it; what that takes asked for first, not assumed.
fn lossy(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let bytes = match String::from_utf8(bytes) {
        Ok(s) => return Ok(s.into_bytes()),
        Err(e) => e.into_bytes(),
    };
    let size = bytes.utf8_chunks().map(|c| c.valid().len() + if c.invalid().is_empty() { 0 } else { 3 }).sum();
    let mut out = String::new();
    out.try_reserve_exact(size).map_err(|_| "a rows file is too large to hold".to_string())?;
    for chunk in bytes.utf8_chunks() {
        out.push_str(chunk.valid());
        if !chunk.invalid().is_empty() {
            out.push('\u{fffd}');
        }
    }
    Ok(out.into_bytes())
}

/// Reads one line: true when it's an object (a row), false when it's JSON of
/// another kind; an error when it isn't JSON.
struct RowVisitor<'v, 'de> {
    line: &'de [u8],
    by_name: &'v HashMap<String, usize>,
    cells: &'v mut [Cell],
    extras: &'v mut Vec<(String, Cell)>,
    /// The extra keys by name, once there are many.
    seen_extras: &'v mut HashMap<String, usize>,
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
            } else if self.extras.len() < 16 {
                // A few: looked through. A key written twice is the last one's.
                match self.extras.iter_mut().find(|(k, _)| *k == *name) {
                    Some(kept) => kept.1 = value_cell,
                    None => self.extras.push((name.into_owned(), value_cell)),
                }
            } else {
                // Many (a row written to slow a reader down): found by name, never looked through.
                if self.seen_extras.is_empty() {
                    self.seen_extras.extend(self.extras.iter().enumerate().map(|(i, (k, _))| (k.clone(), i)));
                }
                match self.seen_extras.get(&*name) {
                    Some(&i) => self.extras[i].1 = value_cell,
                    None => {
                        self.seen_extras.insert(name.to_string(), self.extras.len());
                        self.extras.push((name.into_owned(), value_cell));
                    }
                }
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

/// The most deflate makes of a byte: a stream of 258-byte matches, each in about two bits, with a
/// block's ends and headers allowed for.
const DEFLATE_MOST: usize = 1032;

/// A zip entry's bytes as the archive holds them, inflated (method 8) or as stored (method 0),
/// checked against the size and CRC-32 it declares, within the default limits.
pub fn inflate(name: &str, method: u32, raw: &[u8], size: usize, crc: u32) -> Result<Vec<u8>, String> {
    inflate_within(name, method, raw, size, crc, Limits::default())
}

/// `inflate`, refusing a size past `limits.max_file`, or one deflate couldn't make from `raw`:
/// what the entry declares is checked before anything is allocated for it.
pub fn inflate_within(name: &str, method: u32, raw: &[u8], size: usize, crc: u32, limits: Limits) -> Result<Vec<u8>, String> {
    // A size its bytes can't be is a corrupt entry; one they can, but past the limit, too large to read.
    match method {
        0 if raw.len() != size => return Err(format!("corrupt zip: size mismatch for {name}")),
        8 if size > raw.len().saturating_mul(DEFLATE_MOST).saturating_add(1024) => {
            return Err(format!("corrupt zip: {name} declares {size} bytes, more than {} compressed bytes can hold", raw.len()));
        }
        _ => {}
    }
    if size > limits.max_file {
        return Err(format!("{name} is too large to read: it declares {size} bytes, past {}", limits.max_file));
    }
    let mut bytes = Vec::new();
    match method {
        0 => {
            bytes.try_reserve_exact(size).map_err(|_| format!("{name} is too large to hold"))?;
            bytes.extend_from_slice(raw);
        }
        8 => {
            // Into exactly the size it declares: inflating into a growing list would hold up to twice it.
            bytes.try_reserve_exact(size).map_err(|_| format!("{name} is too large to hold"))?;
            bytes.resize(size, 0);
            let made = miniz_oxide::inflate::decompress_slice_iter_to_slice(&mut bytes, std::iter::once(raw), false, true).map_err(|_| format!("corrupt zip: can't inflate {name}"))?;
            if made != size {
                return Err(format!("corrupt zip: size mismatch for {name}"));
            }
        }
        m => return Err(format!("unsupported zip compression method {m} for {name}")),
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
        r.read("rows/0001.ndjson", text.as_bytes().to_vec(), true).unwrap();
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
        // Past the few looked through, found by name: written twice, still the last one's.
        let mut line = String::from("{\"id\":\"b\"");
        for k in 0..40 {
            line.push_str(&format!(",\"k{k}\":{k}"));
        }
        line.push_str(",\"k3\":\"again\",\"k30\":\"again\"}");
        let r = rows(&line);
        assert_eq!(r.extras(0).len(), 40);
        let again: Vec<_> = r.extras(0).iter().filter(|e| r.raw(0, e.value) == b"again").map(|e| e.key.as_str()).collect();
        assert_eq!(again, vec!["k3", "k30"]);
    }

    #[test]
    fn text_as_text_decoder_reads_it() {
        let mut r = Rows::new(&[]);
        r.read("a", b"\xef\xbb\xbf{\"id\":\"a\"}\n{\"id\":\"b\xff\"}".to_vec(), true).unwrap();
        assert_eq!((r.id(0), r.id(1)), ("a".to_string(), "b\u{fffd}".to_string()));
        let mut kept = Rows::new(&[]);
        kept.read("a", b"\xef\xbb\xbf{\"id\":\"a\"}".to_vec(), false).unwrap();
        assert_eq!(kept.lines()[0].is, LineIs::NotJson);
    }

    #[test]
    fn a_size_an_entry_declares_is_checked_before_anything_is_allocated_for_it() {
        // Two bytes declaring 2^45: refused as corrupt, not an abort for want of 32 TiB.
        let err = inflate("x", 8, &[0x03, 0x00], 1 << 45, 0).unwrap_err();
        assert!(err.starts_with("corrupt zip: x declares 35184372088832 bytes, more than 2 compressed bytes can hold"), "{err}");
        // And under the limit, as much as two bytes can't make.
        assert!(inflate("x", 8, &[0x03, 0x00], 10_000_000, 0).unwrap_err().starts_with("corrupt zip: x declares 10000000 bytes"));
        // Within what deflate could make of the input, but past the limit.
        let small = Limits { max_file: 100, max_rows: 10 };
        let data = vec![b'a'; 1000];
        let deflated = miniz_oxide::deflate::compress_to_vec(&data, 6);
        assert!(inflate_within("x", 8, &deflated, 1000, crc32(&data), small).unwrap_err().contains("too large to read"));
        // As much as deflate can make of a byte is still read.
        let zeros = vec![0u8; 100_000];
        let packed = miniz_oxide::deflate::compress_to_vec(&zeros, 10);
        assert!(packed.len() * DEFLATE_MOST + 1024 >= zeros.len(), "{} bytes", packed.len());
        assert_eq!(inflate("zeros", 8, &packed, zeros.len(), crc32(&zeros)).unwrap().len(), zeros.len());
        // Stored: the size it declares is the size it holds, checked before it's copied.
        assert!(inflate("x", 0, b"abc", 1 << 45, 0).unwrap_err().contains("size mismatch"));
        assert!(inflate("x", 0, b"abc", 2, 0).unwrap_err().contains("size mismatch"));
    }

    #[test]
    fn a_file_or_a_table_past_its_limits_is_refused_and_the_table_is_as_it_was() {
        let small = Limits { max_file: 64, max_rows: 2 };
        let mut r = Rows::new(&["t".into()]);
        r.read_within("one", b"{\"id\":\"a\"}".to_vec(), true, small).unwrap();
        assert!(r.read_within("big", vec![b' '; 65], true, small).unwrap_err().contains("big is too large to read"));
        let err = r.read_within("many", b"{\"id\":\"b\"}\nnope\n{\"id\":\"c\"}".to_vec(), true, small).unwrap_err();
        assert!(err.contains("more rows than a table can"), "{err}");
        // Nothing of the refused file is held: its rows, its lines, its ids.
        assert_eq!((r.len(), r.lines().len()), (1, 0));
        assert_eq!(r.row_of("b"), None);
        r.read_within("two", b"{\"id\":\"b\"}".to_vec(), true, small).unwrap();
        assert_eq!((r.len(), r.row_of("b")), (2, Some(1)));
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
