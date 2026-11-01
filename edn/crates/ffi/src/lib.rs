//! The C binding, for the iOS and Mac apps: the same calls as the
//! WebAssembly and Node bindings, with the same results, so the apps' JSI
//! module (edn/apple) can hand them to `@workspace.sh/edn` unchanged.
//! `include/workspace_edn.h` declares them.
//!
//! Text crosses as UTF-8 with its length, never NUL-terminated. What the
//! library returns is its own: each `EdnBytes` and `EdnColumns` is given back
//! once, to `edn_bytes_free` or `edn_columns_free`. A call returns 0, or 1
//! with the error as JSON (`{message, line, column}`, as the other bindings
//! throw it) in `out`'s place.

use std::slice;

use workspace_edn::formula::{expr_json, json_string, read_formula, value_json};

/// Bytes the library owns: text, or a column's kinds.
#[repr(C)]
pub struct EdnBytes {
    pub ptr: *mut u8,
    pub len: usize,
}

/// A workbook's computed columns, encoded as `workspace_edn::column::compute` describes.
#[repr(C)]
pub struct EdnColumns {
    pub kinds: EdnBytes,
    pub numbers: *mut f64,
    pub numbers_len: usize,
    pub extra: EdnBytes,
    pub index: EdnBytes,
}

fn bytes(v: Vec<u8>) -> EdnBytes {
    let len = v.len();
    let ptr = Box::into_raw(v.into_boxed_slice()) as *mut u8;
    EdnBytes { ptr, len }
}

fn error_json(e: workspace_edn::Error) -> String {
    let mut out = String::from("{\"message\":");
    json_string(&mut out, &e.message);
    out.push_str(&format!(
        ",\"line\":{},\"column\":{}}}",
        e.line.map_or("null".into(), |l| l.to_string()),
        e.column.map_or("null".into(), |c| c.to_string())
    ));
    out
}

/// The text at `ptr`, or the error that it isn't UTF-8.
///
/// # Safety
/// `ptr` points at `len` readable bytes (or `len` is 0).
unsafe fn text<'a>(ptr: *const u8, len: usize) -> Result<&'a str, String> {
    let b = if len == 0 { &[][..] } else { slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(b).map_err(|_| error_json(workspace_edn::Error { message: "text is not UTF-8".into(), line: None, column: None }))
}

unsafe fn answer(ptr: *const u8, len: usize, out: *mut EdnBytes, f: impl FnOnce(&str) -> Result<String, workspace_edn::Error>) -> i32 {
    let (status, s) = match text(ptr, len).and_then(|t| f(t).map_err(error_json)) {
        Ok(s) => (0, s),
        Err(s) => (1, s),
    };
    *out = bytes(s.into_bytes());
    status
}

/// The canonical form of the text.
///
/// # Safety
/// `text` points at `len` readable bytes; `out` is writable.
#[no_mangle]
pub unsafe extern "C" fn edn_canonical(text: *const u8, len: usize, out: *mut EdnBytes) -> i32 {
    answer(text, len, out, workspace_edn::canonical)
}

/// The text read, as a JSON tree (`{"t": kind, "v": …}`).
///
/// # Safety
/// As `edn_canonical`.
#[no_mangle]
pub unsafe extern "C" fn edn_read(text: *const u8, len: usize, out: *mut EdnBytes) -> i32 {
    answer(text, len, out, |t| workspace_edn::read(t).map(|v| value_json(&v)))
}

/// A `.table` formula read, as JSON in the shape `.table`'s evaluator takes.
///
/// # Safety
/// As `edn_canonical`.
#[no_mangle]
pub unsafe extern "C" fn edn_formula(text: *const u8, len: usize, out: *mut EdnBytes) -> i32 {
    answer(text, len, out, |t| read_formula(t).map(|e| expr_json(&e)))
}

/// A workbook's formulas computed (see `workspace_edn::workbook::workbook_from`).
/// On 1, `columns` is untouched and `error` holds the error; on 0, `error` is untouched.
///
/// # Safety
/// `json` points at `len` readable bytes, `numbers` at `numbers_len`
/// doubles (or `numbers_len` is 0); `columns` and `error` are writable.
#[no_mangle]
pub unsafe extern "C" fn edn_compute_workbook(
    json: *const u8,
    len: usize,
    numbers: *const f64,
    numbers_len: usize,
    columns: *mut EdnColumns,
    error: *mut EdnBytes,
) -> i32 {
    let nums = if numbers_len == 0 { &[][..] } else { slice::from_raw_parts(numbers, numbers_len) };
    let book = match text(json, len).and_then(|t| workspace_edn::workbook::workbook_from(t, nums).map_err(error_json)) {
        Ok(b) => b,
        Err(s) => {
            *error = bytes(s.into_bytes());
            return 1;
        }
    };
    let c = workspace_edn::column::compute(&book);
    let numbers_len = c.encoded.numbers.len();
    let numbers = Box::into_raw(c.encoded.numbers.into_boxed_slice()) as *mut f64;
    *columns = EdnColumns {
        kinds: bytes(c.encoded.kinds),
        numbers,
        numbers_len,
        extra: bytes(c.encoded.extra.into_bytes()),
        index: bytes(c.index.into_bytes()),
    };
    0
}

/// Gives back bytes the library returned.
///
/// # Safety
/// `b` came from this library and hasn't been given back.
#[no_mangle]
pub unsafe extern "C" fn edn_bytes_free(b: EdnBytes) {
    if !b.ptr.is_null() {
        drop(Box::from_raw(slice::from_raw_parts_mut(b.ptr, b.len)));
    }
}

/// Gives back columns the library returned.
///
/// # Safety
/// `c` came from `edn_compute_workbook` and hasn't been given back.
#[no_mangle]
pub unsafe extern "C" fn edn_columns_free(c: EdnColumns) {
    edn_bytes_free(c.kinds);
    edn_bytes_free(c.extra);
    edn_bytes_free(c.index);
    if !c.numbers.is_null() {
        drop(Box::from_raw(slice::from_raw_parts_mut(c.numbers, c.numbers_len)));
    }
}
