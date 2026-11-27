//! Times reading NDJSON rows files into a held table, by phase: `cargo run --release -p workspace-table --example read_rows -- <rows files…>`.
use std::time::Instant;
use workspace_table::rows::Rows;

fn main() {
    let files: Vec<String> = std::env::args().skip(1).collect();
    let data: Vec<Vec<u8>> = files.iter().map(|f| std::fs::read(f).expect("a rows file")).collect();
    let fields: Vec<String> = ["title", "stage", "amount", "probability", "owner", "close_date", "note", "weighted"].iter().map(|s| s.to_string()).collect();
    let t = Instant::now();
    let mut ok = 0;
    for d in &data {
        ok += usize::from(std::str::from_utf8(d).is_ok());
    }
    println!("utf-8 check: {:?} ({ok} ok)", t.elapsed());
    let t = Instant::now();
    let mut rows = Rows::new(&fields);
    for (f, d) in files.iter().zip(data) {
        rows.read(f, d, true).expect("rows read");
    }
    println!("read {} rows: {:?}, holding {} MB", rows.len(), t.elapsed(), rows.bytes() / 1_000_000);
}
