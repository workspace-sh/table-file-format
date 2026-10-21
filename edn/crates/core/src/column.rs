//! A formula over a whole column, evaluated inside the core: the columns it
//! reads go in once, its results come out once, so nothing crosses per row.
//! Numbers-only columns travel as `f64`s (`NaN` for an empty cell, which
//! JSON can't hold, so no real value is lost); any other column as JSON.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::eval::{evaluate, needs_host, Scope, Value};
use crate::formula::{json_string, read_formula};
use crate::Error;

/// A column a formula reads, by field name.
pub enum Column {
    /// Numbers, `NaN` for an empty cell.
    Numbers(Vec<f64>),
    Values(Vec<Value>),
}

impl Column {
    fn at(&self, row: usize) -> Value {
        match self {
            Column::Numbers(ns) => match ns.get(row) {
                Some(n) if !n.is_nan() => Value::Number(*n),
                _ => Value::Empty,
            },
            Column::Values(vs) => vs.get(row).cloned().unwrap_or(Value::Empty),
        }
    }

    fn all(&self, rows: usize) -> Value {
        Value::List(Rc::new((0..rows).map(|r| self.at(r)).collect()))
    }
}

struct ColumnScope<'a> {
    columns: &'a HashMap<String, Column>,
    rows: usize,
    row: usize,
    lists: &'a RefCell<HashMap<String, Value>>,
}

impl Scope for ColumnScope<'_> {
    fn field(&self, name: &str) -> Value {
        self.columns.get(name).map_or(Value::Empty, |c| c.at(self.row))
    }

    fn values(&self, name: &str) -> Value {
        if let Some(v) = self.lists.borrow().get(name) {
            return v.clone();
        }
        let v = self.columns.get(name).map_or_else(|| Value::List(Rc::new(vec![Value::Empty; self.rows])), |c| c.all(self.rows));
        self.lists.borrow_mut().insert(name.to_string(), v.clone());
        v
    }
}

/// `formula` for each of `rows` rows over `columns`. Refused when the formula needs the host (see `needs_host`).
pub fn evaluate_column(formula: &str, columns: &HashMap<String, Column>, rows: usize) -> Result<Vec<Value>, Error> {
    let expr = read_formula(formula)?;
    if needs_host(&expr) {
        return Err(Error { message: "this formula needs the host: it follows a relation or reads a Sheet place".into(), line: None, column: None });
    }
    let lists = RefCell::new(HashMap::new());
    let mut out = Vec::with_capacity(rows);
    for row in 0..rows {
        out.push(evaluate(&expr, &ColumnScope { columns, rows, row, lists: &lists }));
    }
    Ok(out)
}

/// Columns given as numbers (`names[i]` → `numbers[i*rows..(i+1)*rows]`) and as JSON (`{"name": [value, …]}`).
pub fn columns_from(names: &[String], numbers: &[f64], json: &str, rows: usize) -> Result<HashMap<String, Column>, Error> {
    let mut columns = HashMap::new();
    for (i, name) in names.iter().enumerate() {
        let slice = numbers.get(i * rows..(i + 1) * rows).ok_or_else(|| bad("the number columns are shorter than the rows"))?;
        columns.insert(name.clone(), Column::Numbers(slice.to_vec()));
    }
    if !json.is_empty() {
        let parsed: serde_json::Map<String, serde_json::Value> = serde_json::from_str(json).map_err(|e| bad(&format!("columns aren't JSON: {e}")))?;
        for (name, v) in parsed {
            let serde_json::Value::Array(items) = v else { return Err(bad("a column is a list of values")) };
            columns.insert(name, Column::Values(items.iter().map(from_json).collect()));
        }
    }
    Ok(columns)
}

fn bad(m: &str) -> Error {
    Error { message: m.into(), line: None, column: None }
}

fn from_json(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Empty,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => n.as_f64().map_or(Value::Empty, Value::Number),
        serde_json::Value::String(s) => Value::Str(s.clone()),
        serde_json::Value::Array(items) => Value::List(Rc::new(items.iter().map(from_json).collect())),
        serde_json::Value::Object(_) => Value::Empty,
    }
}

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
