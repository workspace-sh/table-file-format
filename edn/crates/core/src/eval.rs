//! `.table` formulas evaluated inside the core: the same results as
//! `.table`'s evaluator (packages/core/src/expr.ts), value for value and
//! message for message, for every function that reads only its own row and
//! `values` (a whole column). Formulas that follow relations or read a Sheet
//! view's places (`related`, `linked`, `at`, `range`, `row`, `rows`, and
//! `field` with a row id) are the host's: `needs_host` says so before any
//! row is evaluated, and the app uses its own evaluator for them.
//!
//! Spreadsheet conventions, as there: an empty operand makes arithmetic
//! empty while `sum`, `min`, `max`, `average` and `count` skip empties;
//! failures are error values that pass through whatever uses them.

use std::rc::Rc;

use crate::formula::Expr;

/// A formula's value: `expr.ts`'s `Value`.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// Nothing: `undefined`, `null` or `""` there (all read as empty).
    Empty,
    Number(f64),
    /// Shared: a cell's text is read by many rows without being copied.
    Str(Rc<str>),
    Bool(bool),
    Error(ErrorCode, String),
    /// Shared: a whole column (`values`) is the same list for every row.
    List(Rc<Vec<Value>>),
    /// A JSON object, as an `object` or `geojson` field holds: its text, kept as stored. Formulas
    /// pass it on; as `.table`'s evaluator does in JavaScript, it is equal only to itself (the same
    /// cell), reads as `[object Object]` where text is wanted, and is #VALUE! where a number or a
    /// truth is.
    Object(Rc<str>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    Div0,
    Value,
    Name,
    Ref,
    Num,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::Div0 => "#DIV/0!",
            ErrorCode::Value => "#VALUE!",
            ErrorCode::Name => "#NAME?",
            ErrorCode::Ref => "#REF!",
            ErrorCode::Num => "#NUM!",
        }
    }
}

impl Value {
    pub fn is_empty(&self) -> bool {
        matches!(self, Value::Empty) || matches!(self, Value::Str(s) if s.is_empty())
    }
}

fn err(code: ErrorCode, message: impl Into<String>) -> Value {
    Value::Error(code, message.into())
}

/// What a formula reads (`expr.ts`'s `Scope`, but for Sheet places): its row, another row, a whole column, and other tables.
pub trait Scope {
    fn field(&self, name: &str) -> Value;
    fn field_of(&self, row_id: &str, name: &str) -> Value;
    fn values(&self, name: &str) -> Value;
    fn related(&self, relation: &str, name: &str) -> Value;
    fn linked(&self, table: &str, relation: &str, name: &str) -> Value;
    /// The clock and chance (D55): `today`, `now` or `rand`, as the host's one moment gives them.
    fn clock(&self, what: &str) -> Value;
    /// A place in a Sheet view (D41): one cell's value, or a range's as a list.
    fn place(&self, p: &crate::places::Place) -> Value;
    /// Where a place is: its top row, how many rows, and how many the grid has.
    fn where_(&self, p: &crate::places::Place) -> Result<(i64, i64, i64), Value>;
}

/// The clock and chance (D55): the core's when the host gives it the moment, the host's when it doesn't.
const CLOCK: [&str; 3] = ["today", "now", "rand"];

/// Whether `expr` needs the host's evaluator: it reads the clock, and there's none (`clocked` false).
pub fn needs_host(expr: &Expr, clocked: bool) -> bool {
    match expr {
        Expr::Call(name, args) => (!clocked && CLOCK.contains(&name.as_str())) || args.iter().any(|a| needs_host(a, clocked)),
        _ => false,
    }
}

/// The tables `expr` names to read rows that point at its own (`linked`).
pub fn linked_tables<'a>(expr: &'a Expr, out: &mut Vec<&'a str>) {
    if let Expr::Call(name, args) = expr {
        if name == "linked" {
            if let Some(Expr::Str(table)) = args.first() {
                out.push(table);
            }
        }
        for a in args {
            linked_tables(a, out);
        }
    }
}

pub fn evaluate(expr: &Expr, scope: &dyn Scope) -> Value {
    match expr {
        Expr::Number(n) => Value::Number(*n),
        Expr::Str(s) => Value::Str(s.clone()),
        Expr::Bool(b) => Value::Bool(*b),
        Expr::Nil => Value::Empty,
        Expr::Field(name) => scope.field(name),
        Expr::Call(name, args) => call(name, args, scope),
    }
}

/// Every argument evaluated; the first error among them is the result.
fn values(args: &[Expr], scope: &dyn Scope) -> Result<Vec<Value>, Value> {
    let mut out = Vec::with_capacity(args.len());
    for a in args {
        let v = evaluate(a, scope);
        if matches!(v, Value::Error(..)) {
            return Err(v);
        }
        out.push(v);
    }
    Ok(out)
}

fn flatten(vs: &[Value], out: &mut Vec<Value>) {
    for v in vs {
        if let Value::List(items) = v {
            flatten(items, out);
        } else {
            out.push(v.clone());
        }
    }
}

#[derive(Clone, Copy)]
enum Reduce {
    Add,
    Mul,
    Sub,
    Div,
    Sum,
    Min,
    Max,
    Abs,
    Round,
    Average,
}

fn numeric(name: &str, args: &[Expr], scope: &dyn Scope, how: Reduce, skip_empty: bool, arity: Option<(usize, usize)>) -> Value {
    if let Some((lo, hi)) = arity {
        if args.len() < lo || args.len() > hi {
            return err(ErrorCode::Value, format!("{name} takes {lo}–{hi} arguments"));
        }
    }
    let vs = match values(args, scope) {
        Ok(vs) => vs,
        Err(e) => return e,
    };
    // sum / min / max / average take lists as spreadsheets take ranges: every item counts, blanks skipped.
    // Without a list among them (most rows), the values are read as they are.
    let flat: Vec<Value> = if !vs.iter().any(|v| matches!(v, Value::List(_))) {
        vs
    } else {
        let mut flat = Vec::with_capacity(vs.len());
        for v in vs {
        if let Value::List(items) = &v {
            if !skip_empty {
                return err(ErrorCode::Value, format!("{name} needs single values, got a list"));
            }
            let mut opened = Vec::new();
            flatten(items, &mut opened);
            for item in opened {
                if matches!(item, Value::Error(..)) {
                    return item;
                }
                flat.push(item);
            }
        } else {
            flat.push(v);
        }
        }
        flat
    };
    let mut nums = Vec::with_capacity(flat.len());
    for v in &flat {
        if v.is_empty() {
            if skip_empty {
                continue;
            }
            return Value::Empty;
        }
        match v {
            Value::Number(n) => nums.push(*n),
            other => return err(ErrorCode::Value, format!("{name} needs numbers, got {}", json_of(other))),
        }
    }
    if nums.is_empty() {
        return Value::Empty;
    }
    let result = match how {
        Reduce::Add | Reduce::Sum => nums.iter().fold(0.0, |a, b| a + b),
        Reduce::Mul => nums.iter().fold(1.0, |a, b| a * b),
        Reduce::Sub => {
            if nums.len() == 1 {
                -nums[0]
            } else {
                nums[0] - nums[1]
            }
        }
        Reduce::Div => {
            if nums[1] == 0.0 {
                return err(ErrorCode::Div0, "division by zero");
            }
            nums[0] / nums[1]
        }
        Reduce::Min => nums.iter().copied().fold(f64::INFINITY, f64::min),
        Reduce::Max => nums.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        Reduce::Abs => nums[0].abs(),
        Reduce::Round => round_half_away(nums[0], nums.get(1).copied().unwrap_or(0.0)),
        Reduce::Average => nums.iter().fold(0.0, |a, b| a + b) / nums.len() as f64,
    };
    // JSON has no Infinity or NaN; an overflow is an error, as in spreadsheets.
    if !result.is_finite() {
        return err(ErrorCode::Num, format!("{name} gives a number too large to represent"));
    }
    Value::Number(result)
}

/// Round half away from zero, as spreadsheets do, exactly as `expr.ts` computes it.
fn round_half_away(x: f64, digits: f64) -> f64 {
    let f = js_pow10(digits);
    let r = js_round(x.abs() * f + f64::EPSILON * f) / f;
    if x < 0.0 {
        -r
    } else {
        r
    }
}

/// JavaScript's `Math.round`: halves go up.
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// JavaScript's `10 ** d`.
fn js_pow10(d: f64) -> f64 {
    if d.fract() == 0.0 && d.abs() < 400.0 {
        10f64.powi(d as i32)
    } else {
        10f64.powf(d)
    }
}

fn compare(name: &str, args: &[Expr], scope: &dyn Scope) -> Value {
    if args.len() != 2 {
        return err(ErrorCode::Value, format!("{name} takes 2 arguments"));
    }
    let vs = match values(args, scope) {
        Ok(vs) => vs,
        Err(e) => return e,
    };
    let (a, b) = (&vs[0], &vs[1]);
    if name == "=" || name == "<>" {
        let same = (a.is_empty() && b.is_empty()) || strict_equal(a, b);
        return Value::Bool(if name == "=" { same } else { !same });
    }
    if a.is_empty() || b.is_empty() {
        return Value::Empty;
    }
    let c = match (a, b) {
        (Value::Number(x), Value::Number(y)) => x - y,
        (Value::Str(x), Value::Str(y)) => match x.encode_utf16().cmp(y.encode_utf16()) {
            std::cmp::Ordering::Less => -1.0,
            std::cmp::Ordering::Greater => 1.0,
            std::cmp::Ordering::Equal => 0.0,
        },
        _ => return err(ErrorCode::Value, format!("{name} compares two numbers or two strings")),
    };
    Value::Bool(match name {
        "<" => c < 0.0,
        "<=" => c <= 0.0,
        ">" => c > 0.0,
        _ => c >= 0.0,
    })
}

/// JavaScript's `===` on these values: a list or an error is only ever equal to itself, which a fresh one never is.
fn strict_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x == y,
        (Value::Str(x), Value::Str(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Empty, Value::Empty) => true,
        // The same object: one cell read twice, as JavaScript's === sees it.
        (Value::Object(x), Value::Object(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

fn text(name: &str, args: &[Expr], scope: &dyn Scope, f: fn(&str) -> Value) -> Value {
    if args.len() != 1 {
        return err(ErrorCode::Value, format!("{name} takes 1 argument"));
    }
    let v = evaluate(&args[0], scope);
    if matches!(v, Value::Error(..)) || v.is_empty() {
        return v;
    }
    f(&js_string(&v))
}

fn logic(name: &str, args: &[Expr], scope: &dyn Scope, any: bool) -> Value {
    let vs = match values(args, scope) {
        Ok(vs) => vs,
        Err(e) => return e,
    };
    let mut bools = Vec::with_capacity(vs.len());
    for v in &vs {
        match v {
            Value::Bool(b) => bools.push(*b),
            _ => return err(ErrorCode::Value, format!("{name} needs true or false")),
        }
    }
    Value::Bool(if any { bools.iter().any(|b| *b) } else { bools.iter().all(|b| *b) })
}

fn call(name: &str, args: &[Expr], scope: &dyn Scope) -> Value {
    match name {
        "+" => numeric("+", args, scope, Reduce::Add, false, None),
        "*" => numeric("*", args, scope, Reduce::Mul, false, None),
        "-" => numeric("-", args, scope, Reduce::Sub, false, Some((1, 2))),
        "/" => numeric("/", args, scope, Reduce::Div, false, Some((2, 2))),
        "sum" => numeric("sum", args, scope, Reduce::Sum, true, None),
        "min" => numeric("min", args, scope, Reduce::Min, true, None),
        "max" => numeric("max", args, scope, Reduce::Max, true, None),
        "abs" => numeric("abs", args, scope, Reduce::Abs, false, Some((1, 1))),
        "round" => numeric("round", args, scope, Reduce::Round, false, Some((1, 2))),
        "average" => numeric("average", args, scope, Reduce::Average, true, None),
        "=" | "<>" | "<" | "<=" | ">" | ">=" => compare(name, args, scope),
        "and" => logic("and", args, scope, false),
        "or" => logic("or", args, scope, true),
        "not" => {
            if args.len() != 1 {
                return err(ErrorCode::Value, "not takes 1 argument");
            }
            match evaluate(&args[0], scope) {
                e @ Value::Error(..) => e,
                Value::Bool(b) => Value::Bool(!b),
                _ => err(ErrorCode::Value, "not needs true or false"),
            }
        }
        "if" => {
            if args.len() < 2 || args.len() > 3 {
                return err(ErrorCode::Value, "if takes 2 or 3 arguments");
            }
            let cond = evaluate(&args[0], scope);
            if matches!(cond, Value::Error(..)) {
                return cond;
            }
            if cond.is_empty() {
                return args.get(2).map_or(Value::Empty, |e| evaluate(e, scope));
            }
            match cond {
                Value::Bool(true) => evaluate(&args[1], scope),
                Value::Bool(false) => args.get(2).map_or(Value::Empty, |e| evaluate(e, scope)),
                _ => err(ErrorCode::Value, "if needs true or false"),
            }
        }
        "isblank" => {
            if args.len() != 1 {
                return err(ErrorCode::Value, "isblank takes 1 argument");
            }
            let v = evaluate(&args[0], scope);
            if matches!(v, Value::Error(..)) {
                v
            } else {
                Value::Bool(v.is_empty())
            }
        }
        "concatenate" => match values(args, scope) {
            Err(e) => e,
            Ok(vs) => Value::Str(vs.iter().map(|v| if v.is_empty() { String::new() } else { js_string(v) }).collect::<String>().into()),
        },
        // How many values there are: blanks aren't counted, a list counts its items.
        "count" => match values(args, scope) {
            Err(e) => e,
            Ok(vs) => {
                let mut opened = Vec::new();
                flatten(&vs, &mut opened);
                let mut n = 0.0;
                for v in &opened {
                    if matches!(v, Value::Error(..)) {
                        return v.clone();
                    }
                    if !v.is_empty() {
                        n += 1.0;
                    }
                }
                Value::Number(n)
            }
        },
        "values" => match args {
            [Expr::Str(field)] => scope.values(field),
            _ => err(ErrorCode::Value, "values takes a field name: (values \"quarter\")"),
        },
        "upper" => text("upper", args, scope, |s| Value::Str(s.to_uppercase().into())),
        "lower" => text("lower", args, scope, |s| Value::Str(s.to_lowercase().into())),
        "len" => text("len", args, scope, |s| Value::Number(s.chars().count() as f64)),
        "related" => match args {
            [Expr::Str(relation), Expr::Str(field)] => scope.related(relation, field),
            _ => err(ErrorCode::Value, "related takes a relation field and a field there: (related \"company\" \"industry\")"),
        },
        "linked" => match args {
            [Expr::Str(table), Expr::Str(relation), Expr::Str(field)] => scope.linked(table, relation, field),
            _ => err(ErrorCode::Value, "linked takes a table, its relation field and a field: (linked \"deals\" \"company\" \"value\")"),
        },
        "field" => match args {
            [Expr::Str(name)] => scope.field(name),
            [Expr::Str(name), Expr::Str(row)] => scope.field_of(row, name),
            _ => err(ErrorCode::Value, "field takes a name and, optionally, a row id: (field \"unit price\" \"r7\")"),
        },
        // Reading by place in a Sheet view (D41).
        "at" | "range" => match crate::places::place_of(name, args) {
            Ok(p) => scope.place(&p),
            Err(e) => e,
        },
        "row" | "rows" => match crate::places::place_arg(name, args).and_then(|p| scope.where_(&p)) {
            Err(e) => e,
            Ok((_, height, _)) if name == "rows" => Value::Number(height as f64),
            Ok((top, height, size)) if height > 0 && top >= 1 && top <= size => Value::Number(top as f64),
            Ok(_) => err(ErrorCode::Ref, "that row is off the grid"),
        },
        // The reader's own date, as a date is stored (YYYY-MM-DD); the instant, in UTC; a number from 0 up to 1.
        "today" | "now" | "rand" => {
            if !args.is_empty() {
                return err(ErrorCode::Value, format!("{name} takes no arguments"));
            }
            scope.clock(name)
        }
        _ => err(ErrorCode::Name, format!("unknown function {name}")),
    }
}

/// JavaScript's `String(v)`.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Empty => String::new(),
        Value::Number(n) => js_number(*n),
        Value::Str(s) => s.to_string(),
        Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        Value::Error(code, _) => code.as_str().to_string(),
        Value::List(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_string(),
    }
}

/// JavaScript's `JSON.stringify(v)`, for the messages that quote a value.
pub fn json_of(v: &Value) -> String {
    match v {
        Value::Str(s) => {
            let mut out = String::new();
            crate::formula::json_string(&mut out, s);
            out
        }
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number(*n),
        Value::Object(json) => json.to_string(),
        // Errors and lists never reach a message: they're returned before.
        _ => "null".to_string(),
    }
}

/// JavaScript's `Number.prototype.toString()`: the shortest digits that read back the same, laid out by ECMA-262's rules.
pub fn js_number(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    let sign = if n < 0.0 { "-" } else { "" };
    // Rust's `{:e}` gives the shortest digits that read back the same: "1.2345e6".
    let sci = format!("{:e}", n.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap();
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let e: i32 = exp.parse().unwrap();
    let point = e + 1; // where the decimal point falls after the first `point` digits
    let body = if k <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - k) as usize))
    } else if 0 < point && point <= 21 {
        format!("{}.{}", &digits[..point as usize], &digits[point as usize..])
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let exp = point - 1;
        let exp = if exp >= 0 { format!("+{exp}") } else { exp.to_string() };
        if k == 1 {
            format!("{digits}e{exp}")
        } else {
            format!("{}.{}e{exp}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}
