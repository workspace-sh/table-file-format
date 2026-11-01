//! Runs the shared corpus (edn/corpus/cases.json): every binding runs the same cases.

#[test]
fn corpus() {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../corpus/cases.json")).unwrap();
    let corpus: serde_json::Value = serde_json::from_str(&text).unwrap();
    let mut failed = Vec::new();
    for case in corpus["cases"].as_array().unwrap() {
        let (name, input) = (case["name"].as_str().unwrap(), case["input"].as_str().unwrap());
        let got = workspace_edn::canonical(input);
        if let Some(want) = case["canonical"].as_str() {
            match got {
                Ok(out) if out == want => {
                    // Canonical is a fixed point: printed, it reads back to itself.
                    if workspace_edn::canonical(&out).as_deref() != Ok(want) {
                        failed.push(format!("{name}: canonical form doesn't read back to itself"));
                    }
                }
                Ok(out) => failed.push(format!("{name}: got {out}, want {want}")),
                Err(e) => failed.push(format!("{name}: error {e}, want {want}")),
            }
        } else {
            let want = case["error"].as_str().unwrap();
            match got {
                Err(e) if e.message.contains(want) => {}
                Err(e) => failed.push(format!("{name}: error \"{e}\", want one containing \"{want}\"")),
                Ok(out) => failed.push(format!("{name}: read as {out}, want an error")),
            }
        }
    }
    assert!(failed.is_empty(), "\n{}", failed.join("\n"));
}

#[test]
fn errors_say_where() {
    let e = workspace_edn::read("[1\n 2 :a 1/2]").unwrap_err();
    assert!(e.message.contains("ratio"), "{e}");
    let e = workspace_edn::read("{:a 1\n :b}").unwrap_err();
    assert!(e.line.is_some() && e.column.is_some(), "{e:?}");
}

/// Values built by code, not read: printing alone must make them canonical.
#[test]
fn printing_built_values_is_canonical() {
    use workspace_edn::{print, Value};
    let map = Value::Map(vec![
        (Value::Keyword("b".into()), Value::Int(2)),
        (Value::Keyword("a".into()), Value::Int(1)),
    ]);
    assert_eq!(print(&map), "{:a 1 :b 2}");
    let set = Value::Set(vec![Value::Int(3), Value::Int(1), Value::Int(2)]);
    assert_eq!(print(&set), "#{1 2 3}");
    assert_eq!(print(&Value::Float(1.0)), "1.0");
    assert_eq!(print(&Value::Float(1e21)), "1e21");
    assert_eq!(print(&Value::Float(f64::NAN)), "##NaN");
    assert_eq!(print(&Value::Float(f64::NEG_INFINITY)), "##-Inf");
    assert_eq!(print(&Value::Str("a\u{1}b".into())), "\"a\\u0001b\"");
}
