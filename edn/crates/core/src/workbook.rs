//! A bundle's formulas computed inside the core, across its tables: what
//! `.table`'s workbook (packages/core/src/workbook.ts) computes, value for
//! value, for every formula but those reading a Sheet view's places (left to
//! the host: `needs_host`). Every computed value is worked out once, keyed by
//! table, field and row; a field that depends on itself, through any number
//! of rows or tables, is #REF!.
//!
//! Tables arrive whole: their row ids, their stored columns (numbers-only ones
//! as `f64`s, `NaN` for an empty cell, the rest as JSON values) and their
//! fields' formulas and relations. Results leave whole, one column per
//! formula, so nothing crosses per row.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::eval::{evaluate, needs_host, ErrorCode, Scope, Value};
use crate::formula::{read_formula, Expr};
use crate::Error;

/// A stored column: numbers (`NaN` for empty), or any values.
pub enum Column {
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
}

/// A field as the workbook sees it.
pub struct Field {
    pub name: String,
    /// Its formula, when it's computed. `None` inside: it didn't read (the host reports why).
    pub formula: Option<Option<Expr>>,
    /// The table it points at, when it's a relation.
    pub relation: Option<String>,
    /// Its stored values, when it isn't computed.
    pub column: Option<Column>,
}

pub struct Table {
    pub name: String,
    pub ids: Vec<String>,
    pub fields: Vec<Field>,
}

#[derive(Clone)]
enum Slot {
    Unset,
    Pending,
    Done(Value),
}

/// How deep a chain of computed values may go before it's refused rather than overflow the stack.
const MAX_DEPTH: usize = 2000;

pub struct Workbook {
    tables: Vec<Table>,
    by_name: HashMap<String, usize>,
    /// Per table: field index by name.
    fields: Vec<HashMap<String, usize>>,
    /// Per table and field: one slot per row, for computed fields.
    slots: RefCell<HashMap<(usize, usize), Vec<Slot>>>,
    by_id: RefCell<HashMap<usize, Rc<HashMap<String, usize>>>>,
    columns: RefCell<HashMap<(usize, usize), Value>>,
    backlinks: RefCell<HashMap<(usize, usize), Rc<HashMap<String, Vec<usize>>>>>,
    depth: RefCell<usize>,
}

impl Workbook {
    pub fn new(tables: Vec<Table>) -> Self {
        let by_name = tables.iter().enumerate().map(|(i, t)| (t.name.clone(), i)).collect();
        let fields = tables.iter().map(|t| t.fields.iter().enumerate().map(|(i, f)| (f.name.clone(), i)).collect()).collect();
        Self {
            tables,
            by_name,
            fields,
            slots: RefCell::new(HashMap::new()),
            by_id: RefCell::new(HashMap::new()),
            columns: RefCell::new(HashMap::new()),
            backlinks: RefCell::new(HashMap::new()),
            depth: RefCell::new(0),
        }
    }

    /// Whether any formula of table `t` needs the host (reads a Sheet place).
    pub fn needs_host(&self, t: usize) -> bool {
        self.tables[t].fields.iter().any(|f| matches!(&f.formula, Some(Some(e)) if needs_host(e)))
    }

    /// Forget every computed value, as starting a fresh pass: `.table`'s
    /// computeRows computes each table in a workbook of its own, so a loop
    /// through another table is reported from the table being computed.
    pub fn fresh_pass(&self) {
        self.slots.borrow_mut().clear();
        self.columns.borrow_mut().clear();
        self.backlinks.borrow_mut().clear();
    }

    pub fn table_index(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }

    /// Every row's value of computed field `f` of table `t`.
    pub fn column(&self, t: usize, f: usize) -> Vec<Value> {
        (0..self.tables[t].ids.len()).map(|i| self.value(t, i, f)).collect()
    }

    pub fn tables(&self) -> &[Table] {
        &self.tables
    }

    fn value_by_name(&self, t: usize, i: usize, name: &str) -> Value {
        match self.fields[t].get(name) {
            Some(&f) => self.value(t, i, f),
            None => Value::Error(ErrorCode::Name, format!("no field named {name}")),
        }
    }

    fn value(&self, t: usize, i: usize, f: usize) -> Value {
        let field = &self.tables[t].fields[f];
        let Some(formula) = &field.formula else {
            return field.column.as_ref().map_or(Value::Empty, |c| c.at(i));
        };
        {
            let slots = self.slots.borrow();
            if let Some(s) = slots.get(&(t, f)) {
                match &s[i] {
                    Slot::Done(v) => return v.clone(),
                    Slot::Pending => return Value::Error(ErrorCode::Ref, format!("{} depends on itself", field.name)),
                    Slot::Unset => {}
                }
            }
        }
        let Some(expr) = formula else { return Value::Empty };
        if *self.depth.borrow() > MAX_DEPTH {
            return Value::Error(ErrorCode::Ref, format!("{} reads a chain of values too long to follow", field.name));
        }
        self.set(t, f, i, Slot::Pending);
        *self.depth.borrow_mut() += 1;
        let v = evaluate(expr, &RowScope { book: self, t, i });
        *self.depth.borrow_mut() -= 1;
        self.set(t, f, i, Slot::Done(v.clone()));
        v
    }

    fn set(&self, t: usize, f: usize, i: usize, slot: Slot) {
        let rows = self.tables[t].ids.len();
        self.slots.borrow_mut().entry((t, f)).or_insert_with(|| vec![Slot::Unset; rows])[i] = slot;
    }

    fn index_by_id(&self, t: usize) -> Rc<HashMap<String, usize>> {
        if let Some(m) = self.by_id.borrow().get(&t) {
            return m.clone();
        }
        let m: Rc<HashMap<String, usize>> = Rc::new(self.tables[t].ids.iter().enumerate().map(|(i, id)| (id.clone(), i)).collect());
        self.by_id.borrow_mut().insert(t, m.clone());
        m
    }

    fn values(&self, t: usize, name: &str) -> Value {
        let Some(&f) = self.fields[t].get(name) else {
            return Value::Error(ErrorCode::Name, format!("no field named {name}"));
        };
        if let Some(v) = self.columns.borrow().get(&(t, f)) {
            return v.clone();
        }
        let list = Value::List(Rc::new(self.column(t, f)));
        self.columns.borrow_mut().insert((t, f), list.clone());
        list
    }

    fn linked(&self, t: usize, i: usize, table: &str, relation: &str, name: &str) -> Value {
        let Some(there) = self.table_index(table) else {
            return Value::Error(ErrorCode::Ref, format!("no table {table}"));
        };
        let index = self.backlinks_of(there, relation);
        let id = &self.tables[t].ids[i];
        let rows = index.get(id).cloned().unwrap_or_default();
        Value::List(Rc::new(rows.into_iter().map(|j| self.value_by_name(there, j, name)).collect()))
    }

    fn backlinks_of(&self, there: usize, relation: &str) -> Rc<HashMap<String, Vec<usize>>> {
        let key = self.fields[there].get(relation).copied();
        if let Some(f) = key {
            if let Some(m) = self.backlinks.borrow().get(&(there, f)) {
                return m.clone();
            }
        }
        let mut index: HashMap<String, Vec<usize>> = HashMap::new();
        for j in 0..self.tables[there].ids.len() {
            let v = self.value_by_name(there, j, relation);
            let ids: Vec<Value> = match &v {
                Value::List(items) => items.iter().cloned().collect(),
                other => vec![other.clone()],
            };
            for id in ids {
                if let Value::Str(s) = id {
                    if !s.is_empty() {
                        index.entry(s).or_default().push(j);
                    }
                }
            }
        }
        let index = Rc::new(index);
        if let Some(f) = key {
            self.backlinks.borrow_mut().insert((there, f), index.clone());
        }
        index
    }

    fn related(&self, t: usize, i: usize, relation: &str, name: &str) -> Value {
        let Some(&f) = self.fields[t].get(relation) else {
            return Value::Error(ErrorCode::Name, format!("no field named {relation}"));
        };
        let Some(table) = &self.tables[t].fields[f].relation else {
            return Value::Error(ErrorCode::Value, format!("{relation} doesn't link to another table"));
        };
        let Some(there) = self.table_index(table) else {
            return Value::Error(ErrorCode::Ref, format!("no table {table}"));
        };
        let by_id = self.index_by_id(there);
        let read = |id: &Value| -> Value {
            if id.is_empty() {
                return Value::Empty;
            }
            let key = crate::eval::js_string(id);
            match by_id.get(&key) {
                Some(&target) => self.value_by_name(there, target, name),
                None => Value::Error(ErrorCode::Ref, format!("no row {key} in {table}")),
            }
        };
        match self.value(t, i, f) {
            Value::List(items) => Value::List(Rc::new(items.iter().map(read).collect())),
            one => read(&one),
        }
    }
}

struct RowScope<'a> {
    book: &'a Workbook,
    t: usize,
    i: usize,
}

impl Scope for RowScope<'_> {
    fn field(&self, name: &str) -> Value {
        self.book.value_by_name(self.t, self.i, name)
    }
    fn field_of(&self, row_id: &str, name: &str) -> Value {
        // A reference to a row that isn't there (deleted, say) is broken, as a spreadsheet's is: shown, not silently empty.
        match self.book.index_by_id(self.t).get(row_id) {
            Some(&other) => self.book.value_by_name(self.t, other, name),
            None => Value::Error(ErrorCode::Ref, format!("no row {row_id}")),
        }
    }
    fn values(&self, name: &str) -> Value {
        self.book.values(self.t, name)
    }
    fn related(&self, relation: &str, name: &str) -> Value {
        self.book.related(self.t, self.i, relation, name)
    }
    fn linked(&self, table: &str, relation: &str, name: &str) -> Value {
        self.book.linked(self.t, self.i, table, relation, name)
    }
}

// -- Arriving and leaving ----------------------------------------------------

/// A workbook from JSON (`{"tables":[{"name","ids":[…],"fields":[{"name","formula"?,"relation"?,"values"?:[…],"numbers"?:k}]}]}`)
/// and the number columns it refers to by index (`numbers[k*rows..]`, each table's own row count).
pub fn workbook_from(json: &str, numbers: &[f64]) -> Result<Workbook, Error> {
    let bad = |m: String| Error { message: m, line: None, column: None };
    let root: serde_json::Value = serde_json::from_str(json).map_err(|e| bad(format!("the workbook isn't JSON: {e}")))?;
    let mut tables = Vec::new();
    let mut offset = 0usize;
    for t in root["tables"].as_array().ok_or_else(|| bad("no tables".into()))? {
        let name = t["name"].as_str().unwrap_or_default().to_string();
        let ids: Vec<String> = t["ids"].as_array().map(|a| a.iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect()).unwrap_or_default();
        let rows = ids.len();
        let mut fields = Vec::new();
        for f in t["fields"].as_array().cloned().unwrap_or_default() {
            let formula = f.get("formula").map(|v| v.as_str().and_then(|s| read_formula(s).ok()));
            let relation = f.get("relation").and_then(|v| v.as_str()).map(str::to_string);
            let column = if f.get("numbers").is_some() {
                let slice = numbers.get(offset..offset + rows).ok_or_else(|| bad("the number columns are shorter than the rows".into()))?;
                offset += rows;
                Some(Column::Numbers(slice.to_vec()))
            } else {
                f.get("values").and_then(|v| v.as_array()).map(|vs| Column::Values(vs.iter().map(from_json).collect()))
            };
            fields.push(Field { name: f["name"].as_str().unwrap_or_default().to_string(), formula, relation, column });
        }
        tables.push(Table { name, ids, fields });
    }
    Ok(Workbook::new(tables))
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
