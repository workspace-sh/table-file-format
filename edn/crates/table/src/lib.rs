//! The `.table` engine as every binding calls it (table-file-format#867),
//! in the shape of workspace-protocol's actions engine: one call, an
//! operation's name and its input as JSON text in, JSON text out. A binding
//! exports `call` once, so a module that moves to Rust adds operations here
//! and a wrapper in TypeScript, never anything to a binding.
//!
//! - `call(op, input)`: `input` is a JSON object naming its arguments
//!   (`{"value": "2026-04-01"}`); the answer is `{"value": …}`, or
//!   `{"error": "…"}` for a mistake. It never panics.
//! - `check(op, text)` and `number(op, text)`: the exception for operations
//!   asked once per cell or row, a yes or no, or a number, about one text,
//!   with no JSON either way. In WebAssembly that crosses in about 45 ns
//!   against about 400 ns for `call` (#867 has the timings). Each of these
//!   operations can be asked through `call` too.
//!
//! An operation is named `module.function`, after the TypeScript module and
//! export it serves (`encoding.isDate`); `OPS` lists them all.

pub mod store;

use serde_json::Value as J;
use workspace_edn::encoding;
use workspace_edn::formula::json_string;

/// Every operation `call` knows.
pub const OPS: &[&str] = &[
    "encoding.isDate",
    "encoding.isTime",
    "encoding.isDateTime",
    "encoding.isDuration",
    "encoding.isYearMonth",
    "encoding.instantOf",
    "encoding.completeSeconds",
];

/// The checks `check` answers: a yes or no about one text.
fn checks(op: &str) -> Option<fn(&str) -> bool> {
    Some(match op {
        "encoding.isDate" => encoding::is_date,
        "encoding.isTime" => encoding::is_time,
        "encoding.isDateTime" => encoding::is_date_time,
        "encoding.isDuration" => encoding::is_duration,
        "encoding.isYearMonth" => encoding::is_year_month,
        _ => return None,
    })
}

/// The numbers `number` answers: one from one text.
fn numbers(op: &str) -> Option<fn(&str) -> f64> {
    Some(match op {
        "encoding.instantOf" => encoding::instant_of,
        _ => return None,
    })
}

/// The check `op` of `text`; None when `op` isn't a check.
pub fn check(op: &str, text: &str) -> Option<bool> {
    checks(op).map(|f| f(text))
}

/// The number `op` gives for `text` (NaN included); None when `op` isn't a number.
pub fn number(op: &str, text: &str) -> Option<f64> {
    numbers(op).map(|f| f(text))
}

/// An answer, written as JSON as it's made: what the operations give is
/// small (a yes or no, a number, a text), and serde_json's writer would cost
/// the binary more than the rest of this crate.
enum Answer {
    Bool(bool),
    Number(f64),
    Text(String),
}

/// Run `op` with `input`. Never panics on bad input: a mistake is `{"error": "…"}`.
pub fn call(op: &str, input: &str) -> String {
    let result = serde_json::from_str::<J>(input)
        .map_err(|e| format!("the input isn't JSON: {e}"))
        .and_then(|input| dispatch(op, &input));
    let mut out = String::from("{\"");
    match result {
        Ok(answer) => {
            out.push_str("value\":");
            match answer {
                Answer::Bool(b) => out.push_str(if b { "true" } else { "false" }),
                // JSON has no NaN: a number that isn't one is null. Rust writes the shortest form that reads back the same.
                Answer::Number(n) if n.is_finite() => out.push_str(&n.to_string()),
                Answer::Number(_) => out.push_str("null"),
                Answer::Text(t) => json_string(&mut out, &t),
            }
        }
        Err(message) => {
            out.push_str("error\":");
            json_string(&mut out, &message);
        }
    }
    out.push('}');
    out
}

fn dispatch(op: &str, input: &J) -> Result<Answer, String> {
    if let Some(f) = checks(op) {
        return Ok(Answer::Bool(f(text(input, "value")?)));
    }
    if let Some(f) = numbers(op) {
        return Ok(Answer::Number(f(text(input, "value")?)));
    }
    match op {
        "encoding.completeSeconds" => {
            let raw = text(input, "raw")?;
            Ok(Answer::Text(encoding::complete_seconds(text(input, "type")?, raw).unwrap_or_else(|| raw.to_string())))
        }
        _ => Err(format!("{op:?} isn't an operation; there are {}", OPS.join(", "))),
    }
}

fn text<'a>(input: &'a J, key: &str) -> Result<&'a str, String> {
    input.get(key).and_then(J::as_str).ok_or_else(|| format!("the input needs {key:?}, as text"))
}

#[cfg(test)]
mod tests {
    use super::{call, check, number, OPS};

    #[test]
    fn every_operation_answers_through_call() {
        assert_eq!(call("encoding.isDate", r#"{"value":"2026-04-01"}"#), r#"{"value":true}"#);
        assert_eq!(call("encoding.isDate", r#"{"value":"2026-02-30"}"#), r#"{"value":false}"#);
        assert_eq!(call("encoding.instantOf", r#"{"value":"2026-04-01T09:30:00Z"}"#), r#"{"value":1775035800000}"#);
        assert_eq!(call("encoding.instantOf", r#"{"value":"not a time"}"#), r#"{"value":null}"#);
        assert_eq!(call("encoding.completeSeconds", r#"{"type":"time","raw":"09:30"}"#), r#"{"value":"09:30:00"}"#);
        assert_eq!(call("encoding.completeSeconds", r#"{"type":"time","raw":"a \"quote\""}"#), r#"{"value":"a \"quote\""}"#);
        for op in OPS {
            assert!(!call(op, r#"{"value":"x","type":"time","raw":"x"}"#).contains("isn't an operation"), "{op}");
        }
    }

    #[test]
    fn checks_and_numbers_answer_without_json() {
        assert_eq!(check("encoding.isDate", "2026-04-01"), Some(true));
        assert_eq!(check("encoding.instantOf", ""), None);
        assert_eq!(number("encoding.instantOf", "2026-04-01T09:30:00Z"), Some(1_775_035_800_000.0));
        assert!(number("encoding.instantOf", "x").unwrap().is_nan());
        assert_eq!(number("encoding.isDate", ""), None);
    }

    #[test]
    fn a_mistake_is_an_error_that_says_what_is_wrong() {
        let unknown = call("encoding.nothing", "{}");
        assert!(unknown.starts_with(r#"{"error":"\"encoding.nothing\" isn't an operation; there are encoding.isDate"#), "{unknown}");
        assert_eq!(call("encoding.isDate", r#"{"value":1}"#), r#"{"error":"the input needs \"value\", as text"}"#);
        assert!(call("encoding.isDate", "{").starts_with(r#"{"error":"the input isn't JSON"#));
    }
}
