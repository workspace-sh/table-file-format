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
use crate::fxhash::FxHashMap as HashMap;
use std::rc::Rc;

use crate::eval::{evaluate, linked_tables, needs_host, ErrorCode, Scope, Value};
use crate::formula::{read_formula, Expr};
use crate::holds::{holds, Kind};
use crate::places::{arrange, place_tables, place_use, GridGroup, Place, PlaceRow, SheetView, SortField};
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
    /// What a cell's own formula's value is checked against (D52).
    pub kind: Kind,
    /// Its enum's values, in declared order: how a Sheet view sorts and groups by it.
    pub enum_values: Vec<String>,
}

pub struct Table {
    pub name: String,
    pub ids: Vec<String>,
    pub fields: Vec<Field>,
    /// The host says it works this table out itself.
    pub host: bool,
    /// Its cells' own formulas (D52), by row and field: the ones that apply. `None` inside: it didn't
    /// read (the host reports why), and the cell is empty.
    pub own: HashMap<(usize, usize), Option<Expr>>,
    /// Its loops worked out by iteration (D60): at most `max` passes, until no number changes by more
    /// than `change`.
    pub iteration: Option<Iteration>,
    /// Its Sheet views (D41), whose places its formulas and others' read.
    pub views: Vec<SheetView>,
}

#[derive(Clone, Copy)]
pub struct Iteration {
    pub max: u32,
    pub change: f64,
}

/// The one moment, and source of chance, every formula reads (D55): given by the host.
pub struct Clock {
    /// The reader's own date, `YYYY-MM-DD`.
    pub today: Rc<str>,
    /// The instant, in UTC, to the second: `2026-10-24T12:00:00Z`.
    pub now: Rc<str>,
    /// Where `rand` draws from (SplitMix64): seeded by the host.
    pub state: RefCell<u64>,
}

impl Clock {
    fn rand(&self) -> f64 {
        let mut s = self.state.borrow_mut();
        *s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = *s;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        // The top 53 bits, as a number from 0 up to (not including) 1.
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[derive(Clone)]
enum Slot {
    Unset,
    /// Being worked out, begun at this depth of the stack.
    Pending(usize),
    Done(Value),
}

/// How deep a chain of computed values may go before it's refused rather than overflow the stack.
const MAX_DEPTH: usize = 2000;

/**
 * How deep formulas may nest before a chain of places, like a running total, is worked out down its
 * grid instead of by recursion (`.table`'s workbook: MAX_DEPTH, DeepChain).
 */
const PLACE_DEPTH: usize = 400;

/// A Sheet view's grid (D41).
struct Grid {
    columns: Vec<String>,
    /// The file index of the row at each place: `order[0]` is row 1.
    order: Vec<usize>,
    /// Each row's place (from 1), by file index.
    place: Vec<i64>,
    groups: Vec<GridGroup>,
    /// Sorted or grouped by its own places: numbered in file order, and every place read in it is #REF!.
    looped: bool,
}

enum GridSlot {
    /// Being built, begun at this depth of the stack.
    Pending(usize),
    Ready(Rc<Grid>),
    Missing(Value),
}

/// Where a place is: its table, its grid, its rows top to bottom (possibly off the grid), its fields.
struct Resolved {
    there: usize,
    grid: Rc<Grid>,
    top: i64,
    bottom: i64,
    fields: Vec<String>,
}

pub struct Workbook {
    tables: Vec<Table>,
    by_name: HashMap<String, usize>,
    /// Per table: field index by name.
    fields: Vec<HashMap<String, usize>>,
    /// Per table and field: one slot per row, for computed fields.
    /// Per table, per field: one slot per row (empty until the field is first computed).
    slots: Vec<Vec<RefCell<Vec<Slot>>>>,
    by_id: RefCell<HashMap<usize, Rc<HashMap<String, usize>>>>,
    columns: RefCell<HashMap<(usize, usize), Value>>,
    backlinks: RefCell<HashMap<(usize, usize), Rc<HashMap<String, Vec<usize>>>>>,
    /// What is being worked out, fields (`None`) and grids (`Some`: whether a loop ran through it), innermost last.
    stack: RefCell<Vec<Option<bool>>>,
    grids: RefCell<HashMap<(usize, String), GridSlot>>,
    /// Per table and field: the Sheet view of its own table it reads by place, and whether only rows below.
    places: Vec<Vec<Option<(String, bool)>>>,
    /// Place-reading fields already worked out down their grid.
    warmed: RefCell<std::collections::HashSet<(usize, usize)>>,
    /// A chain of places too deep: unwinding to the top, to work this field out down its grid. Nothing is
    /// kept on the way.
    deep: RefCell<Option<(usize, usize)>>,
    /// Per table: whether the host works it out (`needs_host`).
    hosted: Vec<bool>,
    clock: Option<Clock>,
    /// The tables the host asked for (`None`: every one); the rest are read only through them.
    pub only: Option<Vec<String>>,
    /// Sheet views whose grids the host asked for, by table name; then every formula column is worked out
    /// in the same pass, after them, without iteration (`.table`'s `sheetGrid`).
    pub wanted_grids: HashMap<String, Vec<String>>,
    /// Whether formula columns are wanted (false: grids only, `sheetOrder`).
    pub columns_wanted: bool,
    /// Iterating (D60): the table being worked out, and what the last pass gave, by field and row.
    previous: RefCell<Option<(usize, HashMap<(usize, usize), Value>)>>,
}

impl Workbook {
    pub fn new(tables: Vec<Table>, clock: Option<Clock>) -> Self {
        let by_name = tables.iter().enumerate().map(|(i, t)| (t.name.clone(), i)).collect();
        let slots = tables.iter().map(|t| t.fields.iter().map(|_| RefCell::new(Vec::new())).collect()).collect();
        let fields = tables.iter().map(|t| t.fields.iter().enumerate().map(|(i, f)| (f.name.clone(), i)).collect()).collect();
        let hosted = hosted(&tables, &by_name, clock.is_some());
        let places = tables
            .iter()
            .map(|t| t.fields.iter().map(|f| f.formula.as_ref().and_then(Option::as_ref).and_then(|e| place_use(e, &t.name))).collect())
            .collect();
        Self {
            tables,
            by_name,
            fields,
            slots,
            by_id: RefCell::new(HashMap::default()),
            columns: RefCell::new(HashMap::default()),
            backlinks: RefCell::new(HashMap::default()),
            stack: RefCell::new(Vec::new()),
            grids: RefCell::new(HashMap::default()),
            places,
            warmed: RefCell::new(Default::default()),
            deep: RefCell::new(None),
            hosted,
            clock,
            only: None,
            wanted_grids: HashMap::default(),
            columns_wanted: true,
            previous: RefCell::new(None),
        }
    }

    /// Whether the host works table `t` out: it, or a table it's related to either way, has a formula
    /// that reads a Sheet place or the clock, or is one the host said it works out itself.
    pub fn needs_host(&self, t: usize) -> bool {
        self.hosted[t]
    }

    /// Forget every computed value, as starting a fresh pass: `.table`'s
    /// computeRows computes each table in a workbook of its own, so a loop
    /// through another table is reported from the table being computed.
    pub fn fresh_pass(&self) {
        for table in &self.slots {
            for f in table {
                f.borrow_mut().clear();
            }
        }
        self.columns.borrow_mut().clear();
        self.backlinks.borrow_mut().clear();
        self.grids.borrow_mut().clear();
        self.warmed.borrow_mut().clear();
        *self.deep.borrow_mut() = None;
    }

    pub fn table_index(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }

    /// Whether field `f` of table `t` is worked out: it has a formula, or a cell of it has its own.
    pub fn is_computed(&self, t: usize, f: usize) -> bool {
        self.tables[t].fields[f].formula.is_some() || self.tables[t].own.keys().any(|&(_, g)| g == f)
    }

    /// Iterating (D60): what the last pass of table `t` gave (`None`: not iterating).
    pub fn set_previous(&self, previous: Option<(usize, HashMap<(usize, usize), Value>)>) {
        *self.previous.borrow_mut() = previous;
    }

    /// Every row's value of computed field `f` of table `t`.
    pub fn column(&self, t: usize, f: usize) -> Vec<Value> {
        (0..self.tables[t].ids.len()).map(|i| self.top_value(t, i, f)).collect()
    }

    /// `value`, from the top: a chain of places too deep unwinds to here, is worked out down its grid,
    /// and the value is asked again.
    fn top_value(&self, t: usize, i: usize, f: usize) -> Value {
        loop {
            let v = self.value(t, i, f);
            let deep = self.deep.borrow_mut().take();
            match deep {
                Some((dt, df)) => self.warm(dt, df),
                None => return v,
            }
        }
    }

    /// A field that reads its own Sheet view by place, worked out row by row in that grid's order (bottom
    /// up when it reads only rows below), so each row finds the one it reads done.
    fn warm(&self, t: usize, f: usize) {
        self.warmed.borrow_mut().insert((t, f));
        let (view, forward) = self.places[t][f].clone().expect("a field that reads places");
        let grid = loop {
            let g = self.grid(t, &view);
            let deep = self.deep.borrow_mut().take();
            match deep {
                Some((dt, df)) => self.warm(dt, df),
                None => break g,
            }
        };
        let order: Vec<usize> = match grid {
            Ok(g) => g.order.clone(),
            Err(_) => (0..self.tables[t].ids.len()).collect(),
        };
        if forward {
            for &i in order.iter().rev() {
                self.top_value(t, i, f);
            }
        } else {
            for &i in &order {
                self.top_value(t, i, f);
            }
        }
    }

    /// A Sheet view of table `t` as an app numbers its rows by (`sheetGrid`): its order (file indexes),
    /// its groups, and whether it's sorted by its own places; `None` when it isn't a Sheet view.
    pub fn sheet_grid(&self, t: usize, view: &str) -> Option<(Vec<usize>, Vec<GridGroup>, bool)> {
        let grid = loop {
            let g = self.grid(t, view);
            let deep = self.deep.borrow_mut().take();
            match deep {
                Some((dt, df)) => self.warm(dt, df),
                None => break g,
            }
        };
        grid.ok().map(|g| (g.order.clone(), g.groups.clone(), g.looped))
    }

    /// A loop back to what began at `depth`: every grid being built since then is sorted by its own places.
    fn looped(&self, depth: usize, error: Value) -> Value {
        for entry in self.stack.borrow_mut().iter_mut().skip(depth) {
            if let Some(looped) = entry {
                *looped = true;
            }
        }
        error
    }

    /// A Sheet view of table `t` as a grid, or #REF! when there's no such Sheet view (D41).
    fn grid(&self, t: usize, view: &str) -> Result<Rc<Grid>, Value> {
        let key = (t, view.to_string());
        match self.grids.borrow().get(&key) {
            Some(GridSlot::Pending(depth)) => {
                let depth = *depth;
                return Err(self.looped(depth, Value::Error(ErrorCode::Ref, format!("the Sheet view {view} is sorted by its own places"))));
            }
            Some(GridSlot::Ready(g)) => return Ok(g.clone()),
            Some(GridSlot::Missing(e)) => return Err(e.clone()),
            None => {}
        }
        let table = &self.tables[t];
        let Some(sheet) = table.views.iter().find(|v| v.id == view) else {
            let missing = Value::Error(ErrorCode::Ref, format!("no Sheet view {view}"));
            self.grids.borrow_mut().insert(key, GridSlot::Missing(missing.clone()));
            return Err(missing);
        };
        let depth = self.stack.borrow().len();
        self.grids.borrow_mut().insert(key.clone(), GridSlot::Pending(depth));
        self.stack.borrow_mut().push(Some(false));
        let empty: &[String] = &[];
        let field = |name: &str| match self.fields[t].get(name) {
            Some(&f) => {
                let field = &table.fields[f];
                SortField { enum_values: &field.enum_values, datetime: field.kind.ty == "datetime", any: field.kind.ty == "any" }
            }
            None => SortField { enum_values: empty, datetime: false, any: false },
        };
        let (order, groups) = arrange(table.ids.len(), sheet, &field, &mut |i, name| self.value_by_name(t, i, name), &|i| table.ids[i].clone());
        let looped = self.stack.borrow_mut().pop() == Some(Some(true));
        if self.deep.borrow().is_some() {
            self.grids.borrow_mut().remove(&key);
            return Err(Value::Empty);
        }
        let (order, groups) = if looped { ((0..table.ids.len()).collect(), Vec::new()) } else { (order, groups) };
        let mut place = vec![0i64; order.len()];
        for (p, &i) in order.iter().enumerate() {
            place[i] = p as i64 + 1;
        }
        let columns = sheet.fields.clone().unwrap_or_else(|| table.fields.iter().map(|f| f.name.clone()).collect());
        let grid = Rc::new(Grid { columns, order, place, groups, looped });
        self.grids.borrow_mut().insert(key, GridSlot::Ready(grid.clone()));
        Ok(grid)
    }

    /// A corner's place in a grid: a number (maybe off the grid), `None` for an open end, or why it can't be read.
    fn corner(&self, there: usize, here: bool, grid: &Grid, i: usize, row: &PlaceRow) -> Result<Option<i64>, Value> {
        match row {
            PlaceRow::Open => Ok(None),
            PlaceRow::Id(id) => match self.index_by_id(there).get(id.as_str()) {
                Some(&pinned) => Ok(Some(grid.place[pinned])),
                None => Err(Value::Error(ErrorCode::Ref, format!("no row {id}"))),
            },
            PlaceRow::Offset(_) if !here => Err(Value::Error(ErrorCode::Value, "another table's Sheet view is read by row id, not by offset".into())),
            PlaceRow::Offset(n) => Ok(Some(grid.place[i] + n)),
        }
    }

    fn resolve(&self, t: usize, i: usize, p: &Place) -> Result<Resolved, Value> {
        let here = p.table.as_deref().is_none_or(|n| n == self.tables[t].name);
        let there = if here {
            t
        } else {
            let name = p.table.as_deref().unwrap_or_default();
            self.table_index(name).ok_or_else(|| Value::Error(ErrorCode::Ref, format!("no table {name}")))?
        };
        let grid = self.grid(there, &p.view)?;
        if grid.looped {
            return Err(Value::Error(ErrorCode::Ref, format!("the Sheet view {} is sorted by its own places", p.view)));
        }
        for f in [&p.from.0, &p.to.0] {
            if !self.fields[there].contains_key(f) {
                return Err(Value::Error(ErrorCode::Name, format!("no field named {f}")));
            }
        }
        let a = self.corner(there, here, &grid, i, &p.from.1)?;
        let b = if p.single { a } else { self.corner(there, here, &grid, i, &p.to.1)? };
        // Corners either way round name the same block. An open end runs to the grid's edge on its side
        // and is never swapped: "the top down to the row above" is no rows at all in row 1.
        let (top, bottom) = match (a, b) {
            (Some(a), Some(b)) => (a.min(b), a.max(b)),
            (a, b) => (a.unwrap_or(1), b.unwrap_or(grid.order.len() as i64)),
        };
        let mut fields = vec![p.from.0.clone()];
        if p.to.0 != p.from.0 {
            let f = grid.columns.iter().position(|c| *c == p.from.0);
            let to = grid.columns.iter().position(|c| *c == p.to.0);
            let (Some(f), Some(to)) = (f, to) else {
                let missing = if f.is_none() { &p.from.0 } else { &p.to.0 };
                return Err(Value::Error(ErrorCode::Ref, format!("{missing} isn't a column of {}", p.view)));
            };
            fields = grid.columns[f.min(to)..=f.max(to)].to_vec();
        }
        Ok(Resolved { there, grid, top, bottom, fields })
    }

    fn place(&self, t: usize, i: usize, p: &Place) -> Value {
        // One cell, by offset, in this table: the running total's case, read without building anything.
        if let (true, PlaceRow::Offset(n), true) = (p.single, &p.from.1, p.table.as_deref().is_none_or(|n| n == self.tables[t].name)) {
            let grid = match self.grid(t, &p.view) {
                Ok(g) => g,
                Err(e) => return e,
            };
            if grid.looped {
                return Value::Error(ErrorCode::Ref, format!("the Sheet view {} is sorted by its own places", p.view));
            }
            let Some(&f) = self.fields[t].get(&p.from.0) else {
                return Value::Error(ErrorCode::Name, format!("no field named {}", p.from.0));
            };
            let at = grid.place[i] + n;
            return if at < 1 || at > grid.order.len() as i64 { Value::Empty } else { self.value(t, grid.order[at as usize - 1], f) };
        }
        let r = match self.resolve(t, i, p) {
            Ok(r) => r,
            Err(e) => return e,
        };
        let size = r.grid.order.len() as i64;
        if p.single {
            return if r.top < 1 || r.top > size { Value::Empty } else { self.value_by_name(r.there, r.grid.order[r.top as usize - 1], &r.fields[0]) };
        }
        // Cells off the grid are empty, and every function that takes a list skips empties, so the list
        // holds only the cells on the grid.
        let mut out = Vec::new();
        for at in r.top.max(1)..=r.bottom.min(size) {
            let target = r.grid.order[at as usize - 1];
            for f in &r.fields {
                out.push(self.value_by_name(r.there, target, f));
            }
        }
        Value::List(Rc::new(out))
    }

    fn where_(&self, t: usize, i: usize, p: &Place) -> Result<(i64, i64, i64), Value> {
        let r = self.resolve(t, i, p)?;
        Ok((r.top, (r.bottom - r.top + 1).max(0), r.grid.order.len() as i64))
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
        // Unwinding to the top (a chain too deep): nothing more is worked out on the way.
        if self.deep.borrow().is_some() {
            return Value::Empty;
        }
        let field = &self.tables[t].fields[f];
        // A cell's own formula is used over its field's value or formula (D52).
        let own = self.tables[t].own.get(&(i, f));
        let formula = match (own, &field.formula) {
            (Some(own), _) => own,
            (None, Some(formula)) => formula,
            (None, None) => return field.column.as_ref().map_or(Value::Empty, |c| c.at(i)),
        };
        {
            let s = self.slots[t][f].borrow();
            if let Some(slot) = s.get(i) {
                match slot {
                    Slot::Done(v) => return v.clone(),
                    Slot::Pending(depth) => {
                        // Iterating (D60): a loop reads what the last pass gave, 0 on the first, as a spreadsheet does.
                        if let Some((it, previous)) = &*self.previous.borrow() {
                            if *it == t {
                                return match previous.get(&(f, i)) {
                                    None | Some(Value::Empty) => Value::Number(0.0),
                                    Some(v) => v.clone(),
                                };
                            }
                        }
                        let depth = *depth;
                        drop(s);
                        return self.looped(depth, Value::Error(ErrorCode::Ref, format!("{} depends on itself", field.name)));
                    }
                    Slot::Unset => {}
                }
            }
        }
        let Some(expr) = formula else { return Value::Empty };
        let depth = self.stack.borrow().len();
        if depth > PLACE_DEPTH && self.places[t][f].is_some() && !self.warmed.borrow().contains(&(t, f)) {
            *self.deep.borrow_mut() = Some((t, f));
            return Value::Empty;
        }
        if depth > MAX_DEPTH {
            return Value::Error(ErrorCode::Ref, format!("{} reads a chain of values too long to follow", field.name));
        }
        self.set(t, f, i, Slot::Pending(depth));
        self.stack.borrow_mut().push(None);
        let mut v = evaluate(expr, &RowScope { book: self, t, i });
        self.stack.borrow_mut().pop();
        if self.deep.borrow().is_some() {
            self.set(t, f, i, Slot::Unset);
            return Value::Empty;
        }
        // What a cell's formula gives is checked as a typed value is: one the field can't hold is #VALUE! (D52).
        if own.is_some() && !matches!(v, Value::Error(..)) && !holds(&field.kind, &v) {
            let mut shown = String::new();
            crate::column::json_value(&mut shown, &v);
            v = Value::Error(ErrorCode::Value, format!("{} can't hold {shown}", field.name));
        }
        self.set(t, f, i, Slot::Done(v.clone()));
        v
    }

    fn set(&self, t: usize, f: usize, i: usize, slot: Slot) {
        let rows = self.tables[t].ids.len();
        let mut s = self.slots[t][f].borrow_mut();
        if s.is_empty() {
            s.resize(rows, Slot::Unset);
        }
        s[i] = slot;
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
        let list = Value::List(Rc::new((0..self.tables[t].ids.len()).map(|i| self.value(t, i, f)).collect()));
        if self.deep.borrow().is_none() {
            self.columns.borrow_mut().insert((t, f), list.clone());
        }
        list
    }

    fn linked(&self, t: usize, i: usize, table: &str, relation: &str, name: &str) -> Value {
        let Some(there) = self.table_index(table) else {
            return Value::Error(ErrorCode::Ref, format!("no table {table}"));
        };
        let index = self.backlinks_of(there, relation);
        let id = &self.tables[t].ids[i];
        let rows: &[usize] = index.get(id).map_or(&[], |v| v.as_slice());
        Value::List(Rc::new(rows.iter().map(|&j| self.value_by_name(there, j, name)).collect()))
    }

    fn backlinks_of(&self, there: usize, relation: &str) -> Rc<HashMap<String, Vec<usize>>> {
        let key = self.fields[there].get(relation).copied();
        if let Some(f) = key {
            if let Some(m) = self.backlinks.borrow().get(&(there, f)) {
                return m.clone();
            }
        }
        let mut index: HashMap<String, Vec<usize>> = HashMap::default();
        for j in 0..self.tables[there].ids.len() {
            let v = self.value_by_name(there, j, relation);
            let ids: Vec<Value> = match &v {
                Value::List(items) => items.iter().cloned().collect(),
                other => vec![other.clone()],
            };
            for id in ids {
                if let Value::Str(s) = id {
                    if !s.is_empty() {
                        index.entry(s.to_string()).or_default().push(j);
                    }
                }
            }
        }
        let index = Rc::new(index);
        if let (Some(f), true) = (key, self.deep.borrow().is_none()) {
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
            // Ids are strings; anything else is looked up as JavaScript's String() writes it.
            let owned;
            let key: &str = match id {
                Value::Str(s) => &s[..],
                other => {
                    owned = crate::eval::js_string(other);
                    &owned
                }
            };
            match by_id.get(key) {
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
    fn place(&self, p: &Place) -> Value {
        self.book.place(self.t, self.i, p)
    }
    fn where_(&self, p: &Place) -> Result<(i64, i64, i64), Value> {
        self.book.where_(self.t, self.i, p)
    }
    fn clock(&self, what: &str) -> Value {
        // Without a clock, `needs_host` has given the table to the host: nothing here reads it.
        let Some(clock) = &self.book.clock else { return Value::Empty };
        match what {
            "today" => Value::Str(clock.today.clone()),
            "now" => Value::Str(clock.now.clone()),
            _ => Value::Number(clock.rand()),
        }
    }
}

/// Which tables the host works out. One that needs it takes every table it's related to with it, by a
/// relation or a `linked` either way: a value read across from the host's table has to be the host's.
fn hosted(tables: &[Table], by_name: &HashMap<String, usize>, clocked: bool) -> Vec<bool> {
    let mut group: Vec<usize> = (0..tables.len()).collect();
    fn top(group: &mut [usize], mut t: usize) -> usize {
        while group[t] != t {
            group[t] = group[group[t]];
            t = group[t];
        }
        t
    }
    let join = |group: &mut Vec<usize>, a: usize, b: usize| {
        let (ra, rb) = (top(group, a), top(group, b));
        if ra != rb {
            group[ra] = rb;
        }
    };
    for (t, table) in tables.iter().enumerate() {
        for f in &table.fields {
            if let Some(other) = f.relation.as_deref().and_then(|n| by_name.get(n)) {
                join(&mut group, t, *other);
            }
        }
        for e in formulas(table) {
            let mut named = Vec::new();
            linked_tables(e, &mut named);
            place_tables(e, &mut named);
            for n in named {
                if let Some(other) = by_name.get(n) {
                    join(&mut group, t, *other);
                }
            }
        }
    }
    let own: Vec<bool> = tables
        .iter()
        .map(|t| t.host || formulas(t).any(|e| needs_host(e, clocked)))
        .collect();
    let mut groups_hosted = vec![false; tables.len()];
    for (t, h) in own.iter().enumerate() {
        if *h {
            let g = top(&mut group, t);
            groups_hosted[g] = true;
        }
    }
    (0..tables.len()).map(|t| groups_hosted[top(&mut group, t)]).collect()
}

/// Every formula of a table that reads: its fields' and its cells' own.
fn formulas(t: &Table) -> impl Iterator<Item = &Expr> {
    t.fields.iter().filter_map(|f| f.formula.as_ref().and_then(Option::as_ref)).chain(t.own.values().filter_map(Option::as_ref))
}

// -- Arriving and leaving ----------------------------------------------------

/// A workbook from JSON and the number columns it refers to by index (`numbers[k*rows..]`, each table's
/// own row count):
///
/// ```text
/// {"clock"?: {"today", "now", "seed"}, "only"?: ["name", …],
///  "tables": [{"name", "ids": […], "host"?, "iteration"?: {"max", "change"},
///              "fields": [{"name", "type"?, "many"?, "enum"?: […], "formula"?, "relation"?, "values"?: […], "numbers"?: k}],
///              "views"?: [{"id", "fields"?, "order"?, "sort"?: [{"field", "direction"}], "group"?}],  (Sheet views only)
///              "cells"?: [{"id", "field", "formula"}]}]}
/// ```
///
/// A field's `formula` and a cell's are null when they're in a dialect the core doesn't read. Cells are
/// every line with a formula, in the order read: which apply is decided here (`.table`'s `cellFormulas`).
/// Without a clock, a formula reading it is the host's. With `only`, just those tables' formulas are
/// worked out and given back (and what they read).
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
            let kind = Kind { ty: f["type"].as_str().unwrap_or("string").to_string(), many: f["many"].as_bool().unwrap_or(false) };
            let enum_values = f["enum"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
            fields.push(Field { name: f["name"].as_str().unwrap_or_default().to_string(), formula, relation, column, kind, enum_values });
        }
        let host = t.get("host").and_then(|v| v.as_bool()).unwrap_or(false);
        let iteration = t.get("iteration").and_then(|it| {
            let max = it["max"].as_f64()?;
            (max > 0.0).then(|| Iteration { max: max as u32, change: it["change"].as_f64().unwrap_or(0.0) })
        });
        let own = applying(&ids, &fields, t.get("cells").and_then(|c| c.as_array()).map_or(&[][..], |c| c.as_slice()));
        let strings = |v: &serde_json::Value| -> Vec<String> { v.as_array().map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default() };
        let views = t["views"]
            .as_array()
            .map(|vs| {
                vs.iter()
                    .map(|v| SheetView {
                        id: v["id"].as_str().unwrap_or_default().to_string(),
                        fields: v.get("fields").filter(|f| f.is_array()).map(strings),
                        order: strings(&v["order"]),
                        sort: v["sort"].as_array().map(|ss| ss.iter().map(|s| (s["field"].as_str().unwrap_or_default().to_string(), s["direction"].as_str() == Some("desc"))).collect()).unwrap_or_default(),
                        group: v["group"].as_str().map(str::to_string),
                    })
                    .collect()
            })
            .unwrap_or_default();
        tables.push(Table { name, ids, fields, host, own, iteration, views });
    }
    let clock = root.get("clock").filter(|c| c.is_object()).map(|c| Clock {
        today: c["today"].as_str().unwrap_or_default().into(),
        now: c["now"].as_str().unwrap_or_default().into(),
        state: RefCell::new(c["seed"].as_u64().unwrap_or(0)),
    });
    let mut book = Workbook::new(tables, clock);
    if let Some(g) = root.get("grids").and_then(|g| g.as_object()) {
        book.wanted_grids = g.iter().map(|(t, vs)| (t.clone(), vs.as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default())).collect();
    }
    book.columns_wanted = root.get("columns").and_then(|c| c.as_bool()).unwrap_or(true);
    book.only = root.get("only").and_then(|o| o.as_array()).map(|o| o.iter().filter_map(|n| n.as_str().map(str::to_string)).collect());
    Ok(book)
}

/// The formula each cell has of its own (`.table`'s `cellFormulas`): the first line for a cell, on a row
/// and a field the table has, never `id`. A stored field whose row holds a value as well has none: the
/// value was typed after the formula and wins (D52).
fn applying(ids: &[String], fields: &[Field], cells: &[serde_json::Value]) -> HashMap<(usize, usize), Option<Expr>> {
    let mut out: HashMap<(usize, usize), Option<Expr>> = HashMap::default();
    if cells.is_empty() {
        return out;
    }
    let rows: HashMap<&str, usize> = ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    let by_name: HashMap<&str, usize> = fields.iter().enumerate().map(|(i, f)| (f.name.as_str(), i)).collect();
    for c in cells {
        let (Some(id), Some(name)) = (c["id"].as_str(), c["field"].as_str()) else { continue };
        let (Some(&i), Some(&f)) = (rows.get(id), by_name.get(name)) else { continue };
        if name == "id" || out.contains_key(&(i, f)) {
            continue;
        }
        let field = &fields[f];
        if field.formula.is_none() && field.column.as_ref().is_some_and(|col| !col.at(i).is_empty()) {
            continue;
        }
        out.insert((i, f), c["formula"].as_str().and_then(|s| read_formula(s).ok()));
    }
    out
}

fn from_json(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Empty,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => n.as_f64().map_or(Value::Empty, Value::Number),
        serde_json::Value::String(s) => Value::Str(s.as_str().into()),
        serde_json::Value::Array(items) => Value::List(Rc::new(items.iter().map(from_json).collect())),
        serde_json::Value::Object(_) => Value::Object(v.to_string().into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &str = r#"{"tables":[{"name":"t","ids":["r1"],"fields":[{"name":"d","formula":"(today)"}]}]CLOCK}"#;

    #[test]
    fn the_clock_is_the_hosts_unless_it_gives_the_moment() {
        let without = workbook_from(&TABLE.replace("CLOCK", ""), &[]).unwrap();
        assert!(without.needs_host(0));
        let with = workbook_from(&TABLE.replace("CLOCK", r#","clock":{"today":"2026-10-24","now":"2026-10-24T12:00:00Z","seed":1}"#), &[]).unwrap();
        assert!(!with.needs_host(0));
        assert_eq!(with.column(0, 0), vec![Value::Str("2026-10-24".into())]);
    }
}
