//! Results leaving the core without crossing per row: see `encode`.

use crate::eval::Value;
use crate::formula::json_string;
use crate::fxhash::FxHashMap as HashMap;
use crate::workbook::{Iteration, Workbook};

/// Results for a binding to hand over without crossing per row: a kind per
/// row (0 empty, 1 number, 2 true, 3 false, 4 in `extra`), the numbers (`NaN`
/// where there's none), and, as one JSON array in row order, every string,
/// error (`{"code","message"}`) and list.
pub struct Encoded {
    pub kinds: Vec<u8>,
    pub numbers: Vec<f64>,
    pub extra: String,
}

pub fn encode(results: &[Value]) -> Encoded {
    let mut kinds = Vec::with_capacity(results.len());
    let mut numbers = Vec::with_capacity(results.len());
    let mut extra = String::from("[");
    let mut first = true;
    for v in results {
        let (kind, n) = match v {
            Value::Empty => (0, f64::NAN),
            Value::Number(n) => (1, *n),
            Value::Bool(true) => (2, f64::NAN),
            Value::Bool(false) => (3, f64::NAN),
            other => {
                if !first {
                    extra.push(',');
                }
                first = false;
                json_value(&mut extra, other);
                (4, f64::NAN)
            }
        };
        kinds.push(kind);
        numbers.push(n);
    }
    extra.push(']');
    Encoded { kinds, numbers, extra }
}

pub fn json_value(out: &mut String, v: &Value) {
    match v {
        Value::Empty => out.push_str("null"),
        Value::Number(n) => out.push_str(&crate::eval::js_number(*n)),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Str(s) => json_string(out, s),
        Value::Error(code, message) => {
            out.push_str("{\"code\":\"");
            out.push_str(code.as_str());
            out.push_str("\",\"message\":");
            json_string(out, message);
            out.push('}');
        }
        Value::List(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                json_value(out, item);
            }
            out.push(']');
        }
    }
}

/// A workbook's computed columns, encoded together: `index` (JSON) says, per
/// table, either that the host computes it (`{"host":true}`, a formula reads a
/// Sheet place) or where each computed field's rows are in `kinds` and
/// `numbers` (`{"fields":{"name":[start,rows]}}`). `extra` holds the strings,
/// errors and lists of every column, in order.
pub struct Computed {
    pub index: String,
    pub encoded: Encoded,
}

pub fn compute(book: &Workbook) -> Computed {
    let mut all: Vec<Value> = Vec::new();
    let mut index = String::from("{");
    let mut first_table = true;
    for (t, table) in book.tables().iter().enumerate() {
        if book.only.as_ref().is_some_and(|only| !only.contains(&table.name)) {
            continue;
        }
        if !first_table {
            index.push(',');
        }
        first_table = false;
        json_string(&mut index, &table.name);
        if book.needs_host(t) {
            index.push_str(":{\"host\":true}");
            continue;
        }
        let computed: Vec<usize> = (0..table.fields.len()).filter(|&f| book.is_computed(t, f)).collect();
        let results = match table.iteration {
            Some(it) => iterated(book, t, &computed, it),
            None => {
                book.fresh_pass();
                computed.iter().map(|&f| book.column(t, f)).collect()
            }
        };
        index.push_str(":{\"fields\":{");
        for (k, (&f, column)) in computed.iter().zip(results).enumerate() {
            if k > 0 {
                index.push(',');
            }
            json_string(&mut index, &table.fields[f].name);
            index.push_str(&format!(":[{},{}]", all.len(), table.ids.len()));
            all.extend(column);
        }
        index.push_str("}}");
    }
    index.push('}');
    Computed { index, encoded: encode(&all) }
}

/// Table `t` worked out by iteration (D60): a loop reads what the pass before gave (0 on the first), and
/// passes repeat, at most `max`, until no number changes by more than `change`, as a spreadsheet's
/// iterative calculation does. Every pass reads the same moment; chance goes on drawing.
fn iterated(book: &Workbook, t: usize, computed: &[usize], it: Iteration) -> Vec<Vec<Value>> {
    let mut previous: HashMap<(usize, usize), Value> = HashMap::default();
    let mut out = Vec::new();
    for pass in 0..it.max {
        book.fresh_pass();
        book.set_previous(Some((t, previous.clone())));
        out = computed.iter().map(|&f| book.column(t, f)).collect::<Vec<_>>();
        let mut next: HashMap<(usize, usize), Value> = HashMap::default();
        for (&f, column) in computed.iter().zip(&out) {
            for (i, v) in column.iter().enumerate() {
                next.insert((f, i), v.clone());
            }
        }
        let settled = pass > 0
            && next.iter().all(|(k, v)| match (v, previous.get(k)) {
                (Value::Number(a), Some(Value::Number(b))) => (a - b).abs() <= it.change,
                (v, was) => was.map_or(matches!(v, Value::Empty), |w| same_json(v, w)),
            });
        previous = next;
        if settled {
            break;
        }
    }
    book.set_previous(None);
    out
}

/// Whether two values print the same JSON (`JSON.stringify`), as the host compares a pass with the last.
fn same_json(a: &Value, b: &Value) -> bool {
    let (mut x, mut y) = (String::new(), String::new());
    json_value(&mut x, a);
    json_value(&mut y, b);
    x == y
}
