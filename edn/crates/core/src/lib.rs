//! EDN for Workspace (table-file-format#626): one reader and one canonical
//! printer, shared by `.table` formulas and Workspace actions.
//!
//! Reading is `clojure-reader`'s, within limits of our own and refusing what
//! isn't EDN (Clojure's ratios). Printing is ours: EDN defines no canonical
//! form, so this one does, so that the same value always prints to the same
//! bytes, for sync, diffs, hashes and signatures:
//!
//! - one space between items, none inside brackets, no commas;
//! - map entries and set members in the byte order of their own printed form;
//! - integers in decimal (`N` for one beyond 64 bits), floats in the shortest
//!   form that reads back the same, always with a `.` or an exponent
//!   (`1.0`, not `1`), decimals with `M`; `##NaN`, `##Inf`, `##-Inf`;
//! - strings with `\"`, `\\`, `\n`, `\t` and `\r` escaped, other control
//!   characters as `\uXXXX`, everything else as itself;
//! - characters by name where EDN has one (`\newline`, `\space`, `\tab`,
//!   `\return`), control characters as `\uXXXX`, the rest as themselves.

use clojure_reader::edn::{self, Edn};
use clojure_reader::error::Code;

/// An EDN value, owned, without loss: `1` and `1.0` stay different, and an
/// unknown tag is kept with its value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Nil,
    Bool(bool),
    Str(String),
    Char(char),
    Int(i64),
    /// An integer beyond 64 bits, as its decimal digits (with a leading `-` when negative).
    BigInt(String),
    Float(f64),
    /// An arbitrary-precision decimal, as written without its `M`.
    Decimal(String),
    Symbol(String),
    /// A keyword's name without its colon: `ns/name` or `name`.
    Keyword(String),
    List(Vec<Value>),
    Vector(Vec<Value>),
    /// Entries in no particular order: `print` puts them in canonical order.
    Map(Vec<(Value, Value)>),
    /// Members in no particular order: `print` puts them in canonical order.
    Set(Vec<Value>),
    Tagged(String, Box<Value>),
}

/// What a reader refuses to go past: deep nesting and large texts are how a
/// hostile file exhausts memory or the stack.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_depth: usize,
    pub max_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { max_depth: 256, max_bytes: 16 * 1024 * 1024 }
    }
}

/// Why a text couldn't be read, and where (lines and columns count from 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

impl Error {
    fn at(message: impl Into<String>, line: Option<usize>, column: Option<usize>) -> Self {
        Self { message: message.into(), line, column }
    }
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match (self.line, self.column) {
            (Some(l), Some(c)) => write!(f, "{} (line {l}, column {c})", self.message),
            _ => write!(f, "{}", self.message),
        }
    }
}

/// Read one EDN value from `text`, within the default limits.
pub fn read(text: &str) -> Result<Value, Error> {
    read_with(text, Limits::default())
}

/// Read one EDN value from `text`: exactly one, with nothing after it but
/// whitespace, commas and comments.
pub fn read_with(text: &str, limits: Limits) -> Result<Value, Error> {
    if text.len() > limits.max_bytes {
        return Err(Error::at(format!("the text is over {} bytes", limits.max_bytes), None, None));
    }
    // Checked before reading: a value nested past the limit is never built, so never dropped deep either.
    check_depth(text, limits.max_depth)?;
    let (edn, rest) = edn::read(text).map_err(from_reader)?;
    let rest_start = text.len() - rest.len();
    if let Some(offset) = first_content(rest) {
        let (line, column) = position(text, rest_start + offset);
        return Err(Error::at("there's more than one value", Some(line), Some(column)));
    }
    convert(&edn)
}

/// Read `text` and print it canonically.
pub fn canonical(text: &str) -> Result<String, Error> {
    Ok(print(&read(text)?))
}

fn from_reader(e: clojure_reader::error::Error) -> Error {
    let message = match e.code {
        Code::HashMapDuplicateKey => "a map has the same key twice".to_string(),
        Code::SetDuplicateKey => "a set has the same member twice".to_string(),
        Code::InvalidChar => "this character can't be read".to_string(),
        Code::InvalidEscape => "this escape isn't EDN".to_string(),
        Code::InvalidKeyword => "this keyword isn't EDN".to_string(),
        Code::InvalidNumber => "this number can't be read".to_string(),
        Code::InvalidTag => "this tag isn't EDN".to_string(),
        Code::UnexpectedEOF => "the text ends before the value does".to_string(),
        Code::UnmatchedDelimiter(c) => format!("'{c}' doesn't close anything"),
        other => format!("this can't be read ({other:?})"),
    };
    Error::at(message, e.line, e.column)
}

fn convert(e: &Edn<'_>) -> Result<Value, Error> {
    Ok(match e {
        Edn::Nil => Value::Nil,
        Edn::Bool(b) => Value::Bool(*b),
        Edn::Str(s) => Value::Str(s.to_string()),
        Edn::Char(c) => Value::Char(*c),
        Edn::Int(i) => Value::Int(*i),
        Edn::BigInt(b) => Value::BigInt(b.to_string()),
        Edn::Double(d) => Value::Float(d.into_inner()),
        Edn::BigDec(d) => Value::Decimal(d.to_string()),
        Edn::Rational(_) => return Err(Error::at("ratios (1/2) are Clojure, not EDN", None, None)),
        Edn::Symbol(s) => Value::Symbol(s.to_string()),
        Edn::Key(k) => Value::Keyword(k.trim_start_matches(':').to_string()),
        Edn::List(items) => Value::List(items.iter().map(convert).collect::<Result<_, _>>()?),
        Edn::Vector(items) => Value::Vector(items.iter().map(convert).collect::<Result<_, _>>()?),
        Edn::Map(entries) => Value::Map(entries.iter().map(|(k, v)| Ok((convert(k)?, convert(v)?))).collect::<Result<_, Error>>()?),
        Edn::Set(items) => Value::Set(items.iter().map(convert).collect::<Result<_, _>>()?),
        Edn::Tagged(tag, value) => Value::Tagged(tag.to_string(), Box::new(convert(value)?)),
        #[allow(unreachable_patterns)]
        _ => return Err(Error::at("this value can't be read", None, None)),
    })
}

/// Print `value` in its canonical form.
pub fn print(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Nil => out.push_str("nil"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Str(s) => write_string(out, s),
        Value::Char(c) => write_char(out, *c),
        Value::Int(i) => out.push_str(&i.to_string()),
        Value::BigInt(digits) => {
            out.push_str(digits);
            out.push('N');
        }
        Value::Float(f) => write_float(out, *f),
        Value::Decimal(d) => {
            out.push_str(d);
            out.push('M');
        }
        Value::Symbol(s) => out.push_str(s),
        Value::Keyword(k) => {
            out.push(':');
            out.push_str(k);
        }
        Value::List(items) => write_seq(out, "(", items, ")"),
        Value::Vector(items) => write_seq(out, "[", items, "]"),
        Value::Set(items) => write_seq(out, "#{", items, "}"),
        Value::Map(entries) => {
            let mut sorted: Vec<(String, &Value)> = entries.iter().map(|(k, v)| (print(k), v)).collect();
            sorted.sort_by(|a, b| a.0.cmp(&b.0));
            out.push('{');
            for (i, (k, v)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(' ');
                }
                out.push_str(k);
                out.push(' ');
                write_value(out, v);
            }
            out.push('}');
        }
        Value::Tagged(tag, v) => {
            out.push('#');
            out.push_str(tag);
            out.push(' ');
            write_value(out, v);
        }
    }
}

fn write_seq(out: &mut String, open: &str, items: &[Value], close: &str) {
    let mut printed: Vec<String> = items.iter().map(print).collect();
    if open == "#{" {
        printed.sort();
    }
    out.push_str(open);
    out.push_str(&printed.join(" "));
    out.push_str(close);
}

fn write_float(out: &mut String, f: f64) {
    if f.is_nan() {
        out.push_str("##NaN");
    } else if f.is_infinite() {
        out.push_str(if f > 0.0 { "##Inf" } else { "##-Inf" });
    } else {
        // Debug is Rust's shortest form that reads back the same, and always has a `.` or an exponent.
        out.push_str(&format!("{f:?}"));
    }
}

fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_char(out: &mut String, c: char) {
    match c {
        '\n' => out.push_str("\\newline"),
        ' ' => out.push_str("\\space"),
        '\t' => out.push_str("\\tab"),
        '\r' => out.push_str("\\return"),
        c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
        c => {
            out.push('\\');
            out.push(c);
        }
    }
}

/// Refuse nesting deeper than `max`, before anything is built: brackets
/// counted outside strings, characters and comments.
fn check_depth(text: &str, max: usize) -> Result<(), Error> {
    let bytes = text.as_bytes();
    let (mut depth, mut i) = (0usize, 0usize);
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                i += 1;
                while i < bytes.len() && bytes[i] != b'"' {
                    if bytes[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            // A character literal: `\(` is the character, not a bracket.
            b'\\' => i += 1,
            b';' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'(' | b'[' | b'{' => {
                depth += 1;
                if depth > max {
                    let (line, column) = position(text, i);
                    return Err(Error::at(format!("nested more than {max} deep"), Some(line), Some(column)));
                }
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    Ok(())
}

/// Where the first thing other than whitespace, commas and comments is in `rest`.
fn first_content(rest: &str) -> Option<usize> {
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' | b'\n' | b'\r' | b',' => i += 1,
            b';' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            _ => return Some(i),
        }
    }
    None
}

/// The line and column (from 1, columns in characters) of byte `offset`.
fn position(text: &str, offset: usize) -> (usize, usize) {
    let before = &text[..offset.min(text.len())];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line, column)
}
