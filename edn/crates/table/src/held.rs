//! Tables whose rows the engine holds, by handle, and the operations on them
//! (`rows.*`), in the three shapes a binding exports: `call` (JSON in and
//! out), `call_bytes` (JSON and a file's bytes in, JSON out) and `window`
//! (JSON in, rows out as typed arrays).

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value as J;

use crate::rows::{kind, LineIs, Rows};

static HELD: Mutex<Option<Held>> = Mutex::new(None);

#[derive(Default)]
struct Held {
    next: u32,
    tables: HashMap<u32, Rows>,
}

fn with<T>(f: impl FnOnce(&mut Held) -> T) -> T {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    f(held.get_or_insert_with(Held::default))
}

fn handle(input: &J) -> Result<u32, String> {
    input.get("handle").and_then(J::as_u64).map(|h| h as u32).ok_or_else(|| "the input needs \"handle\", a number".to_string())
}

fn held<T>(input: &J, f: impl FnOnce(&mut Rows) -> Result<T, String>) -> Result<T, String> {
    let h = handle(input)?;
    with(|held| held.tables.get_mut(&h).ok_or_else(|| format!("no table is held as {h}")).and_then(f))
}

/// `rows.*` operations of `call`, as JSON. None when `op` isn't one.
pub(crate) fn call(op: &str, input: &J) -> Option<Result<String, String>> {
    Some(match op {
        "rows.new" => {
            let fields: Vec<String> = match input.get("fields").and_then(J::as_array) {
                Some(f) => f.iter().filter_map(|n| n.as_str().map(str::to_string)).collect(),
                None => return Some(Err("the input needs \"fields\", a list of names".into())),
            };
            Ok(with(|held| {
                held.next += 1;
                held.tables.insert(held.next, Rows::new(&fields));
                held.next.to_string()
            }))
        }
        "rows.free" => handle(input).map(|h| with(|held| held.tables.remove(&h).is_some()).to_string()),
        "rows.count" => held(input, |r| Ok(r.len().to_string())),
        "rows.bytes" => held(input, |r| Ok(r.bytes().to_string())),
        "rows.lines" => held(input, |r| {
            let from = input.get("from").and_then(J::as_u64).unwrap_or(0) as usize;
            let mut out = String::from("[");
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
            held(input, |r| Ok(r.read(name, bytes, strip_bom).to_string()))
        }
        _ => Err(format!("{op:?} isn't an operation that takes bytes; there is rows.read")),
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
    held(input, |r| {
        let from = input.get("from").and_then(J::as_u64).unwrap_or(0) as usize;
        let to = (input.get("to").and_then(J::as_u64).map_or(r.len(), |t| t as usize)).min(r.len());
        let mut w = Window::default();
        let mut units = 0u32;
        let mut keys: Vec<(u32, u16, crate::rows::Cell, Option<String>)> = Vec::new();
        for row in from..to.max(from) {
            keys.clear();
            // The id, then each field and each extra key, put back in the order the line writes them.
            let id = r.id_cell(row);
            keys.push((id.start, ID, id, None));
            for (f, c) in r.cells(row).iter().enumerate() {
                if c.kind != kind::ABSENT {
                    keys.push((c.start, f as u16, *c, None));
                }
            }
            for e in r.extras(row) {
                keys.push((e.value.start, EXTRA, e.value, Some(e.key.clone())));
            }
            keys.sort_by_key(|k| k.0);
            w.entries.push(keys.len() as u16);
            for (_, key, c, name) in &keys {
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
        assert!(call("rows.count", &format!(r#"{{"handle":{h}}}"#)).contains("error"));
    }
}
