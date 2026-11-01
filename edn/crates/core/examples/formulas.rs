//! Times reading the fixtures' formulas natively: `cargo run --release --example formulas -- <formulas.json>`.
fn main() {
    let path = std::env::args().nth(1).expect("a JSON list of formulas");
    let text = std::fs::read_to_string(path).unwrap();
    let formulas: Vec<String> = serde_json::from_str(&text).unwrap();
    let rounds = 5000;
    let t = std::time::Instant::now();
    for _ in 0..rounds {
        for f in &formulas {
            std::hint::black_box(workspace_edn::read(f).unwrap());
        }
    }
    let read = t.elapsed().as_nanos() as f64 / (rounds * formulas.len()) as f64 / 1000.0;
    let t = std::time::Instant::now();
    for _ in 0..rounds {
        for f in &formulas {
            std::hint::black_box(workspace_edn::canonical(f).unwrap());
        }
    }
    let canon = t.elapsed().as_nanos() as f64 / (rounds * formulas.len()) as f64 / 1000.0;
    println!("native read {read:.2} µs, canonical {canon:.2} µs a formula ({} formulas)", formulas.len());
}
