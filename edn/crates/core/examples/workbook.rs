//! Times a workbook like the apps' (100,000 deals pointing at 2,000 companies), natively: `cargo run --release --example workbook`.
use workspace_edn::workbook::workbook_from;

fn main() {
    let mut deals_ids = Vec::new();
    let (mut titles, mut amounts, mut probs, mut companies) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for i in 0..100_000 {
        deals_ids.push(format!("\"d{i}\""));
        titles.push(format!("\"Deal {i}\""));
        amounts.push(((i % 997) * 100) as f64);
        probs.push((i % 100) as f64 / 100.0);
        companies.push(format!("\"c{}\"", i % 2000));
    }
    let c_ids: Vec<String> = (0..2000).map(|i| format!("\"c{i}\"")).collect();
    let c_names: Vec<String> = (0..2000).map(|i| format!("\"Company {i}\"")).collect();
    let c_ind: Vec<String> = (0..2000).map(|i| format!("\"{}\"", ["tech", "retail", "health"][i % 3])).collect();
    let json = format!(
        r#"{{"tables":[{{"name":"companies","ids":[{}],"fields":[{{"name":"name","values":[{}]}},{{"name":"industry","values":[{}]}},{{"name":"open","formula":"(sum (linked \"deals\" \"company\" \"amount\"))"}},{{"name":"deals","formula":"(count (linked \"deals\" \"company\" \"title\"))"}}]}},{{"name":"deals","ids":[{}],"fields":[{{"name":"title","values":[{}]}},{{"name":"amount","numbers":0}},{{"name":"probability","numbers":1}},{{"name":"company","relation":"companies","values":[{}]}},{{"name":"weighted","formula":"(round (* amount probability) 0)"}},{{"name":"industry","formula":"(related \"company\" \"industry\")"}}]}}]}}"#,
        c_ids.join(","), c_names.join(","), c_ind.join(","), deals_ids.join(","), titles.join(","), companies.join(",")
    );
    let mut numbers = amounts.clone();
    numbers.extend(&probs);
    for _ in 0..5 {
        let t = std::time::Instant::now();
        let book = workbook_from(&json, &numbers).unwrap();
        let read = t.elapsed();
        let c = workspace_edn::column::compute(&book);
        println!("read {:?}, compute {:?}, {} values", read, t.elapsed() - read, c.encoded.kinds.len());
    }
}
