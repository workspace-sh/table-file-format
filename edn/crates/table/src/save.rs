//! A held table's rows written out as its rows files (table-file-format#867, step 3c), as
//! table-core's `layoutRows` lays them out (SPEC section 3, D51): each row in the file it was read
//! from, a new row in the file of the row before it, lines that couldn't be read where they were,
//! and a file past the limit split, by a number at the end of the table and by letters before
//! another file.
//!
//! A row is written as its line: as read, or as an edit wrote it, so a row nobody edited keeps its
//! bytes. Computed fields are never stored (SPEC section 2): a line read with one is written without
//! it. A file whose lines are those it has on disk (as read, or as the last save wrote them), in
//! order, with nothing between them, is said to be the same, and not written out again.

use std::collections::HashMap;

use crate::rows::{kind, Rows};

/// About how large a rows file grows before the next one is started (25 MB).
pub const ROWS_FILE_BYTES: usize = 25_000_000;
/// A table's first rows file, and a small table's only one.
pub const FIRST_ROWS_FILE: &str = "0001.ndjson";

/// A rows file's name, as its digits and its letters: four or more digits, any lowercase letters, `.ndjson`.
fn name_parts(name: &str) -> Option<(&str, &str)> {
    let stem = name.strip_suffix(".ndjson")?;
    let digits = stem.bytes().take_while(u8::is_ascii_digit).count();
    let (d, l) = stem.split_at(digits);
    (digits >= 4 && l.bytes().all(|b| b.is_ascii_lowercase())).then_some((d, l))
}

/// The name of the file after `name` at the end of the table: its number plus one, no letters.
pub fn name_after(name: &str) -> String {
    let (digits, _) = name_parts(name).expect("a rows file's name");
    let mut d = digits.as_bytes().to_vec();
    let mut i = d.len();
    loop {
        if i == 0 {
            d.insert(0, b'1');
            break;
        }
        i -= 1;
        if d[i] == b'9' {
            d[i] = b'0';
        } else {
            d[i] += 1;
            break;
        }
    }
    format!("{}.ndjson", String::from_utf8(d).expect("digits"))
}

/// Letters strictly between `lo` and `hi` (none: no upper bound), never ending in `a`, so there's
/// always room for another between: fractional indexing over a to z.
fn letters_between(lo: &str, hi: Option<&str>) -> String {
    let (lo, hi) = (lo.as_bytes(), hi.map(str::as_bytes));
    let mut out = String::new();
    let mut bounded = hi.is_some();
    let mut i = 0;
    loop {
        let l = lo.get(i).map_or(-1, |&c| i32::from(c) - 97);
        let h = if bounded { hi.and_then(|h| h.get(i)).map_or(26, |&c| i32::from(c) - 97) } else { 26 };
        let m = ((l + h).div_euclid(2)).max(1);
        if m > l && m < h {
            out.push(char::from(97 + m as u8));
            return out;
        }
        // No letter fits strictly between here: keep the lower one and go on.
        let c = l.max(0);
        out.push(char::from(97 + c as u8));
        if c != h {
            bounded = false;
        }
        i += 1;
    }
}

/// A name for a file split from `before`, sorting after it and before `after` (none: the end of the table).
pub fn name_between(before: &str, after: Option<&str>) -> String {
    let (digits, letters) = name_parts(before).expect("a rows file's name");
    // A following file of the same number bounds the letters; one of a later number doesn't.
    let hi = after.and_then(name_parts).filter(|(d, _)| *d == digits).map(|(_, l)| l);
    format!("{digits}{}.ndjson", letters_between(letters, hi))
}

/// A line in a file: a row (its slot) or a line that couldn't be read (its place in `Rows::lines`).
#[derive(Clone, Copy)]
enum Entry {
    Row(u32),
    Unread(u32),
}

/// A rows file written: its name, and its text, or none when it's the file on disk. `compare`: the
/// file on disk may hold this text already (what's on disk isn't known), so it's compared before
/// it's written.
pub struct Saved {
    pub name: String,
    pub text: Option<String>,
    pub compare: bool,
}

/// What the table's rows files on disk hold, as far as it knows: what a save compares with.
#[derive(Default)]
pub enum OnDisk {
    /// The files as read.
    #[default]
    AsRead,
    /// What the last save wrote: each file's lines, as a `Lines` of where their bytes are
    /// (`identity`), and the fields it left out. A file it didn't write isn't there.
    Saved { files: HashMap<String, Lines>, computed: Vec<String> },
    /// Not known: a save that may have been left part done. Every file is given, to compare.
    Unknown,
}

/// A file's lines, by where their bytes are, in order: how many, and two hashes of them, made two
/// ways (a file wrongly said to be on disk is a file not written, so 128 bits, not 64).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Lines {
    count: u64,
    a: u64,
    b: u64,
}

impl Lines {
    fn add(&mut self, x: u64) {
        fn mix(mut z: u64) -> u64 {
            // splitmix64's finaliser.
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        }
        self.count += 1;
        self.a = mix(self.a.wrapping_add(x).wrapping_add(0x9e37_79b9_7f4a_7c15));
        self.b = mix(self.b ^ x.rotate_left(23) ^ 0xc2b2_ae3d_27d4_eb4f).wrapping_add(self.count);
    }
}

/// A line's bytes, by where they are: a row's (its file read, or the lines edits wrote, and where
/// in it), or a line that couldn't be read's. Bytes are only ever added, so the same place is the
/// same bytes.
fn identity(rows: &Rows, e: Entry) -> u64 {
    match e {
        Entry::Row(slot) => rows.slot_place(slot as usize),
        Entry::Unread(i) => {
            let l = &rows.lines()[i as usize];
            (u64::from(l.file) << 32) | u64::from(l.start)
        }
    }
}

/// The table's rows as its rows files, in order, and each file's lines by `identity` (what's on disk
/// once they're written). `names`: the rows files read, by name, in the order they were read (none
/// for a table never read from files, laid out from `0001` on). `computed`: the fields not stored.
/// `disk`: what's on disk now. Files left without lines aren't in the result (a table with none keeps
/// one, empty).
#[allow(clippy::type_complexity)]
pub fn layout(rows: &Rows, names: &[String], computed: &[String], limit: usize, disk: &OnDisk) -> Result<(Vec<Saved>, HashMap<String, Lines>), String> {
    let read = rows.files_read();
    if read > 0 && names.len() != read {
        return Err(format!("the table was read from {read} rows files, and {} names were given for them", names.len()));
    }
    if let Some(bad) = names.iter().find(|n| name_parts(n).is_none()) {
        return Err(format!("{bad:?} isn't a rows file's name"));
    }
    let files: Vec<String> = if names.is_empty() { vec![FIRST_ROWS_FILE.to_string()] } else { names.to_vec() };
    // Whether a file the result names is one the table was read from, line for line.
    let as_read = |k: usize| matches!(disk, OnDisk::AsRead) && k < read && names.len() == read;

    // Lines that couldn't be read go after the row they followed (before every row: the first file's
    // start; after a row that's gone: the end of the last file with lines), in the order they were read.
    let n = rows.len();
    let mut front: Vec<u32> = Vec::new();
    let mut tail: Vec<u32> = Vec::new();
    let mut follow: HashMap<usize, Vec<u32>> = HashMap::new();
    for (i, l) in rows.lines().iter().enumerate() {
        if l.rows_before == 0 {
            front.push(i as u32);
            continue;
        }
        let id = rows.slot_id(l.rows_before as usize - 1);
        match rows.row_of(&id) {
            Some(place) => follow.entry(place).or_default().push(i as u32),
            None => tail.push(i as u32),
        }
    }

    // Each row in its file; kept to file order, so a file's rows stay together.
    let fields: Vec<usize> = computed.iter().filter_map(|c| rows.field(c)).collect();
    let mut groups: Vec<Vec<Entry>> = vec![Vec::new(); files.len()];
    groups[0].extend(front.iter().map(|&i| Entry::Unread(i)));
    let mut at = 0usize;
    for place in 0..n {
        let slot = rows.slot(place);
        if let Some(k) = rows.home_file(slot).filter(|&k| k < files.len()) {
            at = at.max(k);
        }
        groups[at].push(Entry::Row(slot as u32));
        if let Some(after) = follow.get(&place) {
            groups[at].extend(after.iter().map(|&i| Entry::Unread(i)));
        }
    }
    let filled = groups.iter().rposition(|g| !g.is_empty()).unwrap_or(0);
    groups[filled].extend(tail.iter().map(|&i| Entry::Unread(i)));

    // A line read with a computed field, written without it.
    let mut stripped: HashMap<u32, Vec<u8>> = HashMap::new();
    if !fields.is_empty() {
        for g in &groups {
            for e in g {
                let Entry::Row(slot) = *e else { continue };
                let cells = rows.slot_cells(slot as usize);
                if fields.iter().any(|&f| cells[f].kind != kind::ABSENT) {
                    let mut values = crate::edit::values(rows, slot as usize)?;
                    for c in computed {
                        values.remove(c);
                    }
                    stripped.insert(slot, crate::edit::render(rows.slot_line(slot as usize), &values));
                }
            }
        }
    }
    let line = |e: Entry| -> &[u8] {
        match e {
            Entry::Row(slot) => stripped.get(&slot).map_or_else(|| rows.slot_line(slot as usize), Vec::as_slice),
            Entry::Unread(i) => rows.unread(&rows.lines()[i as usize]),
        }
    };
    // Where a line is in the file it was read from, if it's written as read.
    let span = |e: Entry| -> Option<(usize, usize, usize)> {
        match e {
            Entry::Row(slot) if !stripped.contains_key(&slot) => rows.slot_at(slot as usize),
            Entry::Row(_) => None,
            Entry::Unread(i) => {
                let l = &rows.lines()[i as usize];
                Some((l.file as usize, l.start as usize, l.len as usize))
            }
        }
    };

    // Each file's lines in parts, a part ending once it has reached the limit; whether a part is its
    // file as read: its lines, in order, one after the other, and nothing else.
    struct Part {
        group: usize,
        name: String,
        from: usize,
        to: usize,
        bytes: usize,
        same: bool,
    }
    let mut parts: Vec<Part> = Vec::new();
    for (k, lines) in groups.iter().enumerate() {
        if lines.is_empty() {
            continue;
        }
        let last = groups[k + 1..].iter().all(Vec::is_empty);
        let following = (k + 1..groups.len()).find(|&j| !groups[j].is_empty()).map(|j| files[j].as_str());
        let mut part = Part { group: k, name: files[k].clone(), from: 0, to: 0, bytes: 0, same: as_read(k) };
        let mut expected = 0usize;
        let mut split = false;
        for (i, &e) in lines.iter().enumerate() {
            // Past the limit: the next file, by number at the end of the table, by letters before another file.
            if part.bytes >= limit && part.to > part.from {
                let name = if last { name_after(&part.name) } else { name_between(&part.name, following) };
                part.same = false;
                parts.push(part);
                part = Part { group: k, name, from: i, to: i, bytes: 0, same: false };
                split = true;
            }
            let l = line(e);
            if part.same {
                match span(e) {
                    Some((f, start, len)) if f == k && start == expected => expected = start + len + 1,
                    _ => part.same = false,
                }
            }
            part.to = i + 1;
            part.bytes += l.len() + 1;
        }
        // All the file's bytes, each line ended: a file read without a last line end, or with blank
        // lines, is written again.
        part.same = part.same && !split && expected == rows.file_len(k);
        parts.push(part);
    }

    // Against what the last save wrote: the same lines, by where their bytes are, and the same fields left out.
    let mut written: HashMap<String, Lines> = HashMap::with_capacity(parts.len().max(1));
    for p in &mut parts {
        let mut lines = Lines::default();
        for &e in &groups[p.group][p.from..p.to] {
            lines.add(identity(rows, e));
        }
        if let OnDisk::Saved { files, computed: left_out } = disk {
            p.same = left_out.as_slice() == computed && files.get(&p.name) == Some(&lines);
        }
        written.insert(p.name.clone(), lines);
    }
    // A file that may be there already as it would be written: only when what's on disk isn't known.
    let compare = matches!(disk, OnDisk::Unknown);
    let mut out = Vec::with_capacity(parts.len().max(1));
    for p in parts {
        let text = if p.same {
            None
        } else {
            let mut text: Vec<u8> = Vec::new();
            text.try_reserve_exact(p.bytes).map_err(|_| format!("{} is too large to write", p.name))?;
            for &e in &groups[p.group][p.from..p.to] {
                text.extend_from_slice(line(e));
                text.push(b'\n');
            }
            Some(String::from_utf8(text).map_err(|_| format!("{} would be written as text that isn't UTF-8", p.name))?)
        };
        out.push(Saved { name: p.name, text, compare });
    }
    // A table with no rows keeps one empty file: git keeps no empty folder, and a table needs its rows/.
    if out.is_empty() {
        let same = match disk {
            OnDisk::AsRead => as_read(0) && rows.file_len(0) == 0,
            OnDisk::Saved { files: on, .. } => on.get(&files[0]).is_some_and(|l| l.count == 0),
            OnDisk::Unknown => false,
        };
        written.insert(files[0].clone(), Lines::default());
        out.push(Saved { name: files[0].clone(), text: (!same).then(String::new), compare });
    }
    Ok((out, written))
}

#[cfg(test)]
mod tests {
    use super::{name_after, name_between};

    #[test]
    fn names_sort_as_rows_files_do() {
        assert_eq!(name_after("0001.ndjson"), "0002.ndjson");
        assert_eq!(name_after("0009b.ndjson"), "0010.ndjson");
        assert_eq!(name_after("9999.ndjson"), "10000.ndjson");
        assert_eq!(name_between("0002.ndjson", Some("0003.ndjson")), "0002m.ndjson");
        assert_eq!(name_between("0002m.ndjson", Some("0003.ndjson")), "0002t.ndjson");
        assert_eq!(name_between("0002.ndjson", Some("0002b.ndjson")), "0002am.ndjson");
        assert_eq!(name_between("0002.ndjson", None), "0002m.ndjson");
    }
}
