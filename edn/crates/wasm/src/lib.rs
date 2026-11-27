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

/// A `.table` engine operation (`workspace_table::call`): its input and answer JSON text. Never throws:
/// a mistake is `{"error": "…"}`.
#[wasm_bindgen]
pub fn call(op: &str, input: &str) -> String {
    workspace_table::call(op, input)
}

/// A `.table` engine check of one text (`workspace_table::check`); undefined when `op` isn't one.
#[wasm_bindgen(js_name = callCheck)]
pub fn call_check(op: &str, text: &str) -> Option<bool> {
    workspace_table::check(op, text)
}

/// A `.table` engine number from one text (`workspace_table::number`); undefined when `op` isn't one.
#[wasm_bindgen(js_name = callNumber)]
pub fn call_number(op: &str, text: &str) -> Option<f64> {
    workspace_table::number(op, text)
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


/// A workbook's computed columns, encoded as `workspace_edn::column::compute` describes.
#[wasm_bindgen]
pub struct ColumnResults {
    kinds: Vec<u8>,
    numbers: Vec<f64>,
    extra: String,
    index: String,
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
    #[wasm_bindgen(getter)]
    pub fn index(&self) -> String {
        self.index.clone()
    }
}

/// A workbook's formulas computed (see `workspace_edn::workbook::workbook_from` and `column::compute`); `index` comes back in `extra`'s place as a second string.
#[wasm_bindgen(js_name = computeWorkbook)]
pub fn compute_workbook(json: &str, numbers: &[f64]) -> Result<ColumnResults, JsValue> {
    let book = workspace_edn::workbook::workbook_from(json, numbers).map_err(error_json)?;
    let c = workspace_edn::column::compute(&book);
    Ok(ColumnResults { kinds: c.encoded.kinds, numbers: c.encoded.numbers, extra: c.encoded.extra, index: c.index })
}

// SPIKE (#867): the engine reading a table from an archive's bytes, timed against JavaScript. Not for merging.
thread_local! {
    static SPIKE: std::cell::RefCell<Option<workspace_table::store::Store>> = const { std::cell::RefCell::new(None) };
}

/// Inflates every rows file and schema in the archive; their total size.
#[wasm_bindgen(js_name = spikeInflate)]
pub fn spike_inflate(bytes: &[u8]) -> Result<f64, JsValue> {
    let e = workspace_table::store::unzip(bytes, |n| n.ends_with(".json") || n.ends_with(".ndjson")).map_err(|e| JsValue::from_str(&e))?;
    Ok(e.iter().map(|(_, d)| d.len()).sum::<usize>() as f64)
}

/// Reads the archive's table into the engine; its row count.
#[wasm_bindgen(js_name = spikeOpen)]
pub fn spike_open(bytes: &[u8]) -> Result<u32, JsValue> {
    let s = workspace_table::store::open(bytes).map_err(|e| JsValue::from_str(&e))?;
    let n = s.rows() as u32;
    SPIKE.with(|k| *k.borrow_mut() = Some(s));
    Ok(n)
}

/// Reads rows already inflated (NDJSON) into the engine; their count.
#[wasm_bindgen(js_name = spikeParse)]
pub fn spike_parse(schema: &str, ndjson: &[u8]) -> Result<u32, JsValue> {
    let s = workspace_table::store::parse(schema, ndjson).map_err(|e| JsValue::from_str(&e))?;
    let n = s.rows() as u32;
    SPIKE.with(|k| *k.borrow_mut() = Some(s));
    Ok(n)
}

/// The bytes the engine's store holds.
#[wasm_bindgen(js_name = spikeStoreBytes)]
pub fn spike_store_bytes() -> f64 {
    SPIKE.with(|k| k.borrow().as_ref().map_or(0, |s| s.bytes()) as f64)
}
