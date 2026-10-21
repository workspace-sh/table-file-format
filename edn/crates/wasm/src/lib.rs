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


/// A formula over whole columns: results encoded as `workspace_edn::column::encode` describes.
#[wasm_bindgen]
pub struct ColumnResults {
    kinds: Vec<u8>,
    numbers: Vec<f64>,
    extra: String,
}

#[wasm_bindgen]
impl ColumnResults {
    #[wasm_bindgen(getter)]
    pub fn kinds(&self) -> Vec<u8> {
        self.kinds.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn numbers(&self) -> Vec<f64> {
        self.numbers.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn extra(&self) -> String {
        self.extra.clone()
    }
}

/// `formula` over `rows` rows: number columns as `number_names` and one `numbers` array, the rest as JSON.
#[wasm_bindgen(js_name = evaluateColumn)]
pub fn evaluate_column(formula: &str, number_names: Vec<String>, numbers: &[f64], json: &str, rows: usize) -> Result<ColumnResults, JsValue> {
    let columns = workspace_edn::column::columns_from(&number_names, numbers, json, rows).map_err(error_json)?;
    let results = workspace_edn::column::evaluate_column(formula, &columns, rows).map_err(error_json)?;
    let e = workspace_edn::column::encode(&results);
    Ok(ColumnResults { kinds: e.kinds, numbers: e.numbers, extra: e.extra })
}
