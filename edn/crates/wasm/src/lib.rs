//! The WebAssembly binding: text in, text out. A value crosses as JSON (see
//! `to_json`) so the binding stays small and the TypeScript side owns how a
//! value looks in JavaScript.

use wasm_bindgen::prelude::*;
use workspace_edn::formula::{json_string, value_json};
use workspace_edn::Error;

/// The canonical form of `text`, or throws `{message, line, column}` as JSON.
#[wasm_bindgen]
pub fn canonical(text: &str) -> Result<String, JsValue> {
    workspace_edn::canonical(text).map_err(error_json)
}

/// `text` read, as a JSON tree (one object per value, `{"t": kind, "v": ...}`), or throws as `canonical` does.
#[wasm_bindgen]
pub fn read(text: &str) -> Result<String, JsValue> {
    workspace_edn::read(text).map(|v| value_json(&v)).map_err(error_json)
}

/// A `.table` formula read, as JSON in the shape `.table`'s evaluator takes (`parseExpr`'s `Expr`), or throws as `canonical` does.
#[wasm_bindgen]
pub fn formula(text: &str) -> Result<String, JsValue> {
    workspace_edn::formula::read_formula(text).map(|e| workspace_edn::formula::expr_json(&e)).map_err(error_json)
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

