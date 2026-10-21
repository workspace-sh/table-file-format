//! The WebAssembly binding: text in, text out. A value crosses as JSON (see
//! `to_json`) so the binding stays small and the TypeScript side owns how a
//! value looks in JavaScript.

use wasm_bindgen::prelude::*;
use workspace_edn::{Error, Value};

/// The canonical form of `text`, or throws `{message, line, column}` as JSON.
#[wasm_bindgen]
pub fn canonical(text: &str) -> Result<String, JsValue> {
    workspace_edn::canonical(text).map_err(error_json)
}

/// `text` read, as a JSON tree (one object per value, `{"t": kind, "v": ...}`), or throws as `canonical` does.
#[wasm_bindgen]
pub fn read(text: &str) -> Result<String, JsValue> {
    let value = workspace_edn::read(text).map_err(error_json)?;
    let mut out = String::new();
    to_json(&mut out, &value);
    Ok(out)
}

fn error_json(e: Error) -> JsValue {
    let mut out = String::from("{\"message\":");
    json_string(&mut out, &e.message);
    out.push_str(&format!(
        ",\"line\":{},\"column\":{}}}",
        e.line.map_or("null".into(), |l| l.to_string()),
        e.column.map_or("null".into(), |c| c.to_string())
    ));
    JsValue::from_str(&out)
}

/// A value as JSON, kind by kind: nothing is lost, so `1` and `1.0`, a list
/// and a vector, a keyword and a string all stay apart. Integers travel as
/// strings, so one beyond 2^53 survives JavaScript's numbers.
fn to_json(out: &mut String, v: &Value) {
    let tagged = |out: &mut String, t: &str| {
        out.push_str("{\"t\":\"");
        out.push_str(t);
        out.push_str("\",\"v\":");
    };
    match v {
        Value::Nil => out.push_str("{\"t\":\"nil\"}"),
        Value::Bool(b) => {
            tagged(out, "bool");
            out.push_str(if *b { "true" } else { "false" });
            out.push('}');
        }
        Value::Str(s) => scalar(out, "str", s),
        Value::Char(c) => scalar(out, "char", &c.to_string()),
        Value::Int(i) => scalar(out, "int", &i.to_string()),
        Value::BigInt(d) => scalar(out, "int", d),
        Value::Float(f) => scalar(out, "float", &workspace_edn::print(&Value::Float(*f))),
        Value::Decimal(d) => scalar(out, "decimal", d),
        Value::Symbol(s) => scalar(out, "sym", s),
        Value::Keyword(k) => scalar(out, "kw", k),
        Value::List(items) => seq(out, "list", items),
        Value::Vector(items) => seq(out, "vec", items),
        Value::Set(items) => seq(out, "set", items),
        Value::Map(entries) => {
            tagged(out, "map");
            out.push('[');
            for (i, (k, val)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push('[');
                to_json(out, k);
                out.push(',');
                to_json(out, val);
                out.push(']');
            }
            out.push_str("]}");
        }
        Value::Tagged(tag, inner) => {
            out.push_str("{\"t\":\"tag\",\"tag\":");
            json_string(out, tag);
            out.push_str(",\"v\":");
            to_json(out, inner);
            out.push('}');
        }
    }
}

fn scalar(out: &mut String, t: &str, s: &str) {
    out.push_str("{\"t\":\"");
    out.push_str(t);
    out.push_str("\",\"v\":");
    json_string(out, s);
    out.push('}');
}

fn seq(out: &mut String, t: &str, items: &[Value]) {
    out.push_str("{\"t\":\"");
    out.push_str(t);
    out.push_str("\",\"v\":[");
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        to_json(out, item);
    }
    out.push_str("]}");
}

fn json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}
