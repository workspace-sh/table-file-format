// The C binding gives what the core gives, and gives errors as the other bindings do.

use workspace_edn_ffi::*;

fn call(f: unsafe extern "C" fn(*const u8, usize, *mut EdnBytes) -> i32, text: &str) -> (i32, String) {
    let mut out = EdnBytes { ptr: std::ptr::null_mut(), len: 0 };
    let status = unsafe { f(text.as_ptr(), text.len(), &mut out) };
    let s = unsafe { String::from_utf8(std::slice::from_raw_parts(out.ptr, out.len).to_vec()).unwrap() };
    unsafe { edn_bytes_free(out) };
    (status, s)
}

#[test]
fn text_calls_match_the_core() {
    assert_eq!(call(edn_canonical, "{:b 2 :a 1}"), (0, workspace_edn::canonical("{:b 2 :a 1}").unwrap()));
    let read = workspace_edn::formula::value_json(&workspace_edn::read("[1 \"two\"]").unwrap());
    assert_eq!(call(edn_read, "[1 \"two\"]"), (0, read));
    let formula = workspace_edn::formula::expr_json(&workspace_edn::formula::read_formula("(+ 1 2)").unwrap());
    assert_eq!(call(edn_formula, "(+ 1 2)"), (0, formula));
    // Empty text: whatever the core says of it, the binding says.
    assert_eq!(call(edn_canonical, "").0, if workspace_edn::canonical("").is_ok() { 0 } else { 1 });
}

#[test]
fn an_error_is_json_with_where_it_is() {
    let (status, s) = call(edn_canonical, "{:a");
    assert_eq!(status, 1);
    assert!(s.starts_with("{\"message\":"), "{s}");
    assert!(s.contains("\"line\":"), "{s}");
}

#[test]
fn text_that_isnt_utf8_is_an_error() {
    let bad = [0xffu8, 0xfe];
    let mut out = EdnBytes { ptr: std::ptr::null_mut(), len: 0 };
    let status = unsafe { edn_read(bad.as_ptr(), bad.len(), &mut out) };
    let s = unsafe { String::from_utf8(std::slice::from_raw_parts(out.ptr, out.len).to_vec()).unwrap() };
    unsafe { edn_bytes_free(out) };
    assert_eq!(status, 1);
    assert!(s.contains("not UTF-8"), "{s}");
}

#[test]
fn a_workbook_is_computed_as_the_core_computes_it() {
    let json = r#"{"clock":{"today":"2026-10-26","now":"2026-10-26T12:00:00Z","seed":1},"tables":[{"name":"t","ids":["a","b"],"views":[],"fields":[{"name":"n","type":"number","numbers":0},{"name":"twice","type":"number","formula":"(* n 2)"}]}]}"#;
    let numbers = [3.0, 4.5];
    let mut cols = EdnColumns {
        kinds: EdnBytes { ptr: std::ptr::null_mut(), len: 0 },
        numbers: std::ptr::null_mut(),
        numbers_len: 0,
        extra: EdnBytes { ptr: std::ptr::null_mut(), len: 0 },
        index: EdnBytes { ptr: std::ptr::null_mut(), len: 0 },
    };
    let mut err = EdnBytes { ptr: std::ptr::null_mut(), len: 0 };
    let status = unsafe { edn_compute_workbook(json.as_ptr(), json.len(), numbers.as_ptr(), numbers.len(), &mut cols, &mut err) };
    assert_eq!(status, 0);
    let want = workspace_edn::column::compute(&workspace_edn::workbook::workbook_from(json, &numbers).unwrap());
    unsafe {
        assert_eq!(std::slice::from_raw_parts(cols.kinds.ptr, cols.kinds.len), &want.encoded.kinds[..]);
        assert_eq!(std::slice::from_raw_parts(cols.numbers, cols.numbers_len), &want.encoded.numbers[..]);
        assert_eq!(std::slice::from_raw_parts(cols.extra.ptr, cols.extra.len), want.encoded.extra.as_bytes());
        assert_eq!(std::slice::from_raw_parts(cols.index.ptr, cols.index.len), want.index.as_bytes());
        assert!(want.encoded.numbers.contains(&9.0), "{:?}", want.encoded.numbers);
        edn_columns_free(cols);
    }

    let bad = "{";
    let mut untouched = std::mem::MaybeUninit::<EdnColumns>::uninit();
    let status = unsafe { edn_compute_workbook(bad.as_ptr(), bad.len(), std::ptr::null(), 0, untouched.as_mut_ptr(), &mut err) };
    assert_eq!(status, 1);
    let s = unsafe { String::from_utf8(std::slice::from_raw_parts(err.ptr, err.len).to_vec()).unwrap() };
    unsafe { edn_bytes_free(err) };
    assert!(s.starts_with("{\"message\":"), "{s}");
}
