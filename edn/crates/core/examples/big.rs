//! Times reading and printing a large input: `cargo run --release --example big`.
fn main() {
    let rows: Vec<String> = (0..100_000)
        .map(|i| format!("{{:id \"r{i}\" :title \"Row {i}\" :amount {} :tags #{{:a :b}} :at #inst \"2026-10-21T00:00:00Z\"}}", i as f64 * 1.5))
        .collect();
    let text = format!("[{}]", rows.join(" "));
    let t = std::time::Instant::now();
    let v = workspace_edn::read(&text).unwrap();
    let read = t.elapsed();
    let t = std::time::Instant::now();
    let out = workspace_edn::print(&v);
    let print = t.elapsed();
    println!("{:.1} MB: read {:?}, print {:?}, out {:.1} MB", text.len() as f64 / 1e6, read, print, out.len() as f64 / 1e6);
}
