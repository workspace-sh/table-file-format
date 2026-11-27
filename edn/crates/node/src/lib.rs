//! The native Node binding (N-API), for Linux's app: the same calls as the
//! WebAssembly binding, with the same results, so `@workspace.sh/edn`
//! can use either. An error is thrown with its message as JSON
//! (`{message, line, column}`), as the WebAssembly binding throws it.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use workspace_edn::formula::{expr_json, json_string, read_formula, value_json};

fn error(e: workspace_edn::Error) -> napi::Error {
    let mut out = String::from("{\"message\":");
    json_string(&mut out, &e.message);
    out.push_str(&format!(
        ",\"line\":{},\"column\":{}}}",
        e.line.map_or("null".into(), |l| l.to_string()),
        e.column.map_or("null".into(), |c| c.to_string())
    ));
    napi::Error::new(Status::InvalidArg, out)
}

/// The canonical form of `text`.
#[napi]
pub fn canonical(text: String) -> Result<String> {
    workspace_edn::canonical(&text).map_err(error)
}

/// A `.table` formula read, as JSON in the shape `.table`'s evaluator takes.
#[napi]
pub fn formula(text: String) -> Result<String> {
    read_formula(&text).map(|e| expr_json(&e)).map_err(error)
}

/// `text` read, as a JSON tree (`{"t": kind, "v": …}`).
#[napi]
pub fn read(text: String) -> Result<String> {
    workspace_edn::read(&text).map(|v| value_json(&v)).map_err(error)
}

/// A `.table` engine operation (`workspace_table::call`): its input and answer JSON text. Never throws:
/// a mistake is `{"error": "…"}`.
#[napi]
pub fn call(op: String, input: String) -> String {
    workspace_table::call(&op, &input)
}

/// A `.table` engine check of one text (`workspace_table::check`); undefined when `op` isn't one.
#[napi(js_name = "callCheck")]
pub fn call_check(op: String, text: String) -> Option<bool> {
    workspace_table::check(&op, &text)
}

/// A `.table` engine number from one text (`workspace_table::number`); undefined when `op` isn't one.
#[napi(js_name = "callNumber")]
pub fn call_number(op: String, text: String) -> Option<f64> {
    workspace_table::number(&op, &text)
}

/// A workbook's computed columns, encoded as `workspace_edn::column::compute` describes.
#[napi(object)]
pub struct ColumnResults {
    pub kinds: Uint8Array,
    pub numbers: Float64Array,
    pub extra: String,
    pub index: String,
}

/// A workbook's formulas computed (see `workspace_edn::workbook::workbook_from`).
#[napi(js_name = "computeWorkbook")]
pub fn compute_workbook(json: String, numbers: Float64Array) -> Result<ColumnResults> {
    let book = workspace_edn::workbook::workbook_from(&json, &numbers).map_err(error)?;
    let c = workspace_edn::column::compute(&book);
    Ok(ColumnResults { kinds: Uint8Array::new(c.encoded.kinds), numbers: Float64Array::new(c.encoded.numbers), extra: c.encoded.extra, index: c.index })
}

// SPIKE (#867): the engine reading a table from an archive's bytes, timed against JavaScript. Not for merging.
thread_local! {
    static SPIKE: std::cell::RefCell<Option<workspace_table::store::Store>> = const { std::cell::RefCell::new(None) };
}

#[napi(js_name = "spikeInflate")]
pub fn spike_inflate(bytes: Uint8Array) -> Result<f64> {
    let e = workspace_table::store::unzip(&bytes, |n| n.ends_with(".json") || n.ends_with(".ndjson")).map_err(|e| napi::Error::from_reason(e))?;
    Ok(e.iter().map(|(_, d)| d.len()).sum::<usize>() as f64)
}

#[napi(js_name = "spikeOpen")]
pub fn spike_open(bytes: Uint8Array) -> Result<u32> {
    let s = workspace_table::store::open(&bytes).map_err(|e| napi::Error::from_reason(e))?;
    let n = s.rows() as u32;
    SPIKE.with(|k| *k.borrow_mut() = Some(s));
    Ok(n)
}

#[napi(js_name = "spikeParse")]
pub fn spike_parse(schema: String, ndjson: Uint8Array) -> Result<u32> {
    let s = workspace_table::store::parse(&schema, &ndjson).map_err(|e| napi::Error::from_reason(e))?;
    let n = s.rows() as u32;
    SPIKE.with(|k| *k.borrow_mut() = Some(s));
    Ok(n)
}

#[napi(js_name = "spikeStoreBytes")]
pub fn spike_store_bytes() -> f64 {
    SPIKE.with(|k| k.borrow().as_ref().map_or(0, |s| s.bytes()) as f64)
}
