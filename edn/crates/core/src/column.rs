//! Results leaving the core without crossing per row: see `encode`.

use crate::eval::Value;
use crate::formula::json_string;
use crate::workbook::Workbook;

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

fn json_value(out: &mut String, v: &Value) {
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
    for (t, table) in book.tables().iter().enumerate() {
        if t > 0 {
            index.push(',');
        }
        json_string(&mut index, &table.name);
        if book.needs_host(t) {
            index.push_str(":{\"host\":true}");
            continue;
        }
        book.fresh_pass();
        index.push_str(":{\"fields\":{");
        let mut first = true;
        for (f, field) in table.fields.iter().enumerate() {
            if field.formula.is_none() {
                continue;
            }
            if !first {
                index.push(',');
            }
            first = false;
            json_string(&mut index, &field.name);
            index.push_str(&format!(":[{},{}]", all.len(), table.ids.len()));
            all.extend(book.column(t, f));
        }
        index.push_str("}}");
    }
    index.push('}');
    Computed { index, encoded: encode(&all) }
}
