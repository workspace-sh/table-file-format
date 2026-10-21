//! `.table` formulas read through the core: EDN in, the expression tree
//! `.table`'s evaluator (packages/core/src/expr.ts) already takes out, so
//! nothing is converted twice. The same tree as `parseExpr` gives for every
//! formula both read; where `table-expr-v1` reads a word EDN doesn't (`:x`,
//! `a,b`), this refuses it.

use crate::{read, Error, Value};

/// A formula's expression: `parseExpr`'s `Expr`.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(f64),
    Str(std::rc::Rc<str>),
    Bool(bool),
    Nil,
    /// A bare word: a field of the same row.
    Field(String),
    /// `(fn arg …)`, its name lower-cased and a former name read as today's (D48).
    Call(String, Vec<Expr>),
}

/// Names `.table` once used for its own forms, read as today's (DECISIONS D48).
const FORMER_NAMES: [(&str, &str); 3] = [("column", "values"), ("lookup", "related"), ("concat", "concatenate")];

/// Read one formula.
pub fn read_formula(text: &str) -> Result<Expr, Error> {
    expr(&read(text)?)
}

fn expr(v: &Value) -> Result<Expr, Error> {
    Ok(match v {
        Value::Int(i) => Expr::Number(*i as f64),
        Value::Float(f) => Expr::Number(*f),
        Value::Str(s) => Expr::Str(s.as_str().into()),
        Value::Bool(b) => Expr::Bool(*b),
        Value::Nil => Expr::Nil,
        Value::Symbol(s) => Expr::Field(s.clone()),
        Value::List(items) => {
            let Some((head, args)) = items.split_first() else {
                return Err(fail("expected a function name after ("));
            };
            let Value::Symbol(name) = head else {
                return Err(fail("expected a function name after ("));
            };
            let lower = name.to_lowercase();
            let name = FORMER_NAMES.iter().find(|(old, _)| *old == lower).map_or(lower.clone(), |(_, new)| new.to_string());
            Expr::Call(name, args.iter().map(expr).collect::<Result<_, _>>()?)
        }
        Value::BigInt(_) | Value::Decimal(_) => return Err(fail("a formula's numbers are ordinary numbers (no N or M)")),
        _ => return Err(fail("a formula is made of numbers, strings, true, false, nil, field names and (function …) calls")),
    })
}

fn fail(message: &str) -> Error {
    Error { message: message.into(), line: None, column: None }
}

/// A formula's expression as JSON in `parseExpr`'s shape
/// (`{"kind":"call","fn":"sum","args":[…]}`), for a binding to hand to
/// JavaScript as it is.
pub fn expr_json(e: &Expr) -> String {
    let mut out = String::new();
    write_json(&mut out, e);
    out
}

fn write_json(out: &mut String, e: &Expr) {
    match e {
        Expr::Number(n) => {
            out.push_str("{\"kind\":\"number\",\"value\":");
            if n.is_finite() {
                out.push_str(&format!("{n}"));
            } else {
                out.push_str("null");
            }
            out.push('}');
        }
        Expr::Str(s) => {
            out.push_str("{\"kind\":\"string\",\"value\":");
            json_string(out, s);
            out.push('}');
        }
        Expr::Bool(b) => out.push_str(if *b { "{\"kind\":\"boolean\",\"value\":true}" } else { "{\"kind\":\"boolean\",\"value\":false}" }),
        Expr::Nil => out.push_str("{\"kind\":\"nil\"}"),
        Expr::Field(name) => {
            out.push_str("{\"kind\":\"field\",\"name\":");
            json_string(out, name);
            out.push('}');
        }
        Expr::Call(name, args) => {
            out.push_str("{\"kind\":\"call\",\"fn\":");
            json_string(out, name);
            out.push_str(",\"args\":[");
            for (i, a) in args.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(out, a);
            }
            out.push_str("]}");
        }
    }
}

/// `s` as a JSON string.
pub fn json_string(out: &mut String, s: &str) {
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

/// A value as JSON, for a binding to hand to JavaScript: `{"t": kind, "v": …}`.
pub fn value_json(v: &Value) -> String {
    let mut out = String::new();
    value_json_into(&mut out, v);
    out
}

/// A value as JSON, kind by kind: nothing is lost, so `1` and `1.0`, a list
/// and a vector, a keyword and a string all stay apart. Integers travel as
/// strings, so one beyond 2^53 survives JavaScript's numbers.
fn value_json_into(out: &mut String, v: &Value) {
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
        Value::Float(f) => scalar(out, "float", &crate::print(&Value::Float(*f))),
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
                value_json_into(out, k);
                out.push(',');
                value_json_into(out, val);
                out.push(']');
            }
            out.push_str("]}");
        }
        Value::Tagged(tag, inner) => {
            out.push_str("{\"t\":\"tag\",\"tag\":");
            json_string(out, tag);
            out.push_str(",\"v\":");
            value_json_into(out, inner);
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
        value_json_into(out, item);
    }
    out.push_str("]}");
}

