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

/// A formula over whole columns: results encoded as `workspace_edn::column::encode` describes.
#[napi(object)]
pub struct ColumnResults {
    pub kinds: Uint8Array,
    pub numbers: Float64Array,
    pub extra: String,
}

/// `formula` over `rows` rows: number columns as `number_names` and one `numbers` array, the rest as JSON.
#[napi(js_name = "evaluateColumn")]
pub fn evaluate_column(formula: String, number_names: Vec<String>, numbers: Float64Array, json: String, rows: u32) -> Result<ColumnResults> {
    let rows = rows as usize;
    let columns = workspace_edn::column::columns_from(&number_names, &numbers, &json, rows).map_err(error)?;
    let results = workspace_edn::column::evaluate_column(&formula, &columns, rows).map_err(error)?;
    let e = workspace_edn::column::encode(&results);
    Ok(ColumnResults { kinds: Uint8Array::new(e.kinds), numbers: Float64Array::new(e.numbers), extra: e.extra })
}
