//! The native Node binding (N-API), for Linux's app: the same three calls as
//! the WebAssembly binding, with the same results, so `@workspace.sh/edn`
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
