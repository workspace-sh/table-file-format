//! Reads a JSON list of formulas once each, natively: `cargo run --release --example many -- <formulas.json>`.
fn main() {
    let path = std::env::args().nth(1).expect("a JSON list of formulas");
    let formulas: Vec<String> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let t = std::time::Instant::now();
    for f in &formulas {
        std::hint::black_box(workspace_edn::read(f).unwrap());
    }
    println!("native: {} formulas read in {} ms", formulas.len(), t.elapsed().as_millis());
}
