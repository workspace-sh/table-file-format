//! Workspace actions, `workspace-action-v1`: an action read from its EDN and
//! run to completion inside a budget (workspace-protocol `docs/actions/`).
//!
//! An action only asks. Every `env/…` call (a fetch, a read of another file,
//! the time, formatting, a location, a question on screen) is a request the
//! app answers; the evaluator has no network, files or clock of its own. A
//! run that reaches a request it has no answer for stops and says what it
//! needs. The app performs it and runs the action again with every answer so
//! far. The same action, inputs and answers always give the same result, and
//! the answers it used are its run record.
//!
//! A request outside what the action declares in `:needs`, or outside what
//! this device has granted, is refused here, before the app is asked.
//!
//! The language is a small, pure subset of Clojure over EDN values: literals,
//! `let`, `if`, `when`, `do`, `and`, `or`, `fn`, keywords as functions, and
//! the built-ins in `call_builtin`. There is no mutation, no recursion by
//! name, and nothing that outlives the run.

use std::rc::Rc;

use crate::{print, read, Error, Value};

/// What one run may use. Steps count every expression evaluated; the heap
/// counts the bytes of strings and the items of collections a run makes.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    pub steps: u64,
    pub heap: u64,
    pub depth: usize,
    pub requests: usize,
}

impl Default for Budget {
    fn default() -> Self {
        Self { steps: 100_000, heap: 8 * 1024 * 1024, depth: 128, requests: 64 }
    }
}

/// What an action may ask for: declared by the action in `:needs`, and
/// granted by this device in the same shape. A request needs both.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Needs {
    /// Hosts that `env/fetch` may GET from, exactly (`nominatim.openstreetmap.org`).
    pub fetch: Vec<String>,
    /// Files that `env/read` may read, by path relative to the document.
    pub read: Vec<String>,
    pub locate: bool,
    pub ask: bool,
}

impl Needs {
    fn from_value(v: Option<&Value>) -> Result<Needs, String> {
        let mut needs = Needs::default();
        let Some(v) = v else { return Ok(needs) };
        let Value::Map(entries) = v else { return Err(":needs is a map".into()) };
        for (k, v) in entries {
            match k {
                Value::Keyword(k) if k == "fetch" => needs.fetch = strings(v, ":needs :fetch")?,
                Value::Keyword(k) if k == "read" => needs.read = strings(v, ":needs :read")?,
                Value::Keyword(k) if k == "locate" => needs.locate = v == &Value::Bool(true),
                Value::Keyword(k) if k == "ask" => needs.ask = v == &Value::Bool(true),
                // A need a later version adds: kept, and never granted by this one.
                _ => {}
            }
        }
        for path in &needs.read {
            if !relative_path(path) {
                return Err(format!("{path:?} isn't a path inside the workspace"));
            }
        }
        Ok(needs)
    }

    fn to_value(&self) -> Value {
        let list = |xs: &[String]| Value::Vector(xs.iter().map(|x| Value::Str(x.clone())).collect());
        Value::Map(vec![
            (kw("fetch"), list(&self.fetch)),
            (kw("read"), list(&self.read)),
            (kw("locate"), Value::Bool(self.locate)),
            (kw("ask"), Value::Bool(self.ask)),
        ])
    }
}

fn strings(v: &Value, what: &str) -> Result<Vec<String>, String> {
    match v {
        Value::Vector(xs) | Value::List(xs) | Value::Set(xs) => xs
            .iter()
            .map(|x| match x {
                Value::Str(s) => Ok(s.clone()),
                _ => Err(format!("{what} is a list of strings")),
            })
            .collect(),
        _ => Err(format!("{what} is a list of strings")),
    }
}

/// A path inside the workspace: relative, with no `..`, no empty part and no backslash.
fn relative_path(p: &str) -> bool {
    !p.is_empty() && !p.starts_with('/') && !p.contains('\\') && p.split('/').all(|part| !part.is_empty() && part != "..")
}

/// An action as its document stores it.
#[derive(Debug, Clone)]
pub struct Action {
    pub id: String,
    /// `:on`, as written: `:open`, `:tap`, `[:edit "isbn"]`, `[:change "file.table"]`. The app decides when.
    pub on: Value,
    /// `:fresh`, an ISO 8601 duration: how long a kept value is good for.
    pub fresh: Option<String>,
    pub needs: Needs,
    params: Vec<Value>,
    body: Vec<Value>,
}

/// Read an action's EDN: a map with `:id` (a keyword) and `:fn`, `(fn [request env ctx] …)`.
pub fn parse_action(text: &str) -> Result<Action, Error> {
    let fail = |m: String| Error { message: m, line: None, column: None };
    let value = read(text)?;
    let Value::Map(entries) = &value else { return Err(fail("an action is a map".into())) };
    let get = |name: &str| entries.iter().find(|(k, _)| matches!(k, Value::Keyword(k) if k == name)).map(|(_, v)| v);
    if let Some(v) = get("v") {
        if v != &Value::Int(1) {
            return Err(fail(format!("this is version {}, and only version 1 can run here", print(v))));
        }
    }
    let id = match get("id") {
        Some(Value::Keyword(k)) => k.clone(),
        _ => return Err(fail("an action's :id is a keyword, like :geo/place".into())),
    };
    let fresh = match get("fresh") {
        None => None,
        Some(Value::Str(s)) if s.starts_with('P') && s.len() > 1 => Some(s.clone()),
        Some(_) => return Err(fail(":fresh is an ISO 8601 duration, like \"P1D\"".into())),
    };
    let needs = Needs::from_value(get("needs")).map_err(fail)?;
    let (params, body) = match get("fn") {
        Some(Value::List(items)) if matches!(items.first(), Some(Value::Symbol(s)) if s == "fn") => match items.get(1) {
            Some(Value::Vector(params)) if params.len() <= 3 && items.len() > 2 => (params.clone(), items[2..].to_vec()),
            _ => return Err(fail(":fn takes up to three arguments, [request env ctx], and has a body".into())),
        },
        _ => return Err(fail("an action's :fn is (fn [request env ctx] …)".into())),
    };
    for p in &params {
        check_pattern(p).map_err(fail)?;
    }
    Ok(Action { id, on: get("on").cloned().unwrap_or(Value::Nil), fresh, needs, params, body })
}

/// How a request the app performed came out.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    Value(Value),
    /// `offline`, `timeout`, `denied` or `error`, and why.
    Failed(String, String),
}

/// What one run is given.
#[derive(Debug, Clone)]
pub struct Input {
    /// The trigger's inputs: a row, a place name.
    pub request: Value,
    /// This run: the trigger, where in the document, who, locale, the last kept value.
    pub ctx: Value,
    /// What this device grants the action.
    pub granted: Needs,
    /// The requests performed so far, by their printed form, and how each came out.
    pub answers: Vec<(String, Answer)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// Ran to completion. `asked` is the run record: each request used and its answer.
    Done { keep: Option<Value>, show: Option<Value>, asked: Vec<(Value, Value)> },
    /// Stopped at a request with no answer yet: perform it and run again.
    Needs { request: Value, asked: Vec<(Value, Value)> },
    /// `offline`, `timeout`, `denied` or `error` from an answer; `refused` for a request outside
    /// what's declared or granted; `budget` when a limit is reached; `failed` for a mistake in the action.
    Failed { reason: String, message: String, asked: Vec<(Value, Value)> },
}

/// Run `action` once with `input`, within `budget`.
pub fn run(action: &Action, input: &Input, budget: Budget) -> Outcome {
    let mut m = Machine { action, input, budget, steps: 0, heap: 0, depth: 0, asked: Vec::new() };
    let result = m.call_action();
    let asked = std::mem::take(&mut m.asked);
    match result {
        Ok(v) => match result_parts(v) {
            Ok((keep, show)) => Outcome::Done { keep, show, asked },
            Err(message) => Outcome::Failed { reason: "failed".into(), message, asked },
        },
        Err(Stop::Needs(request)) => Outcome::Needs { request, asked },
        Err(Stop::Failed(reason, message)) => Outcome::Failed { reason, message, asked },
    }
}

/// An action returns `{:keep v}`, `{:show v}` or both.
fn result_parts(v: Val) -> Result<(Option<Value>, Option<Value>), String> {
    let Val::Data(Value::Map(entries)) = v else { return Err("an action returns a map with :keep or :show".into()) };
    let (mut keep, mut show) = (None, None);
    for (k, v) in entries {
        match k {
            Value::Keyword(k) if k == "keep" => keep = Some(v),
            Value::Keyword(k) if k == "show" => show = Some(v),
            other => return Err(format!("an action returns :keep and :show, not {}", print(&other))),
        }
    }
    if keep.is_none() && show.is_none() {
        return Err("an action returns a map with :keep or :show".into());
    }
    Ok((keep, show))
}

/// Run an action from text, for the bindings: the action's EDN and an input map,
/// `{:request … :ctx … :granted {…} :answers [[request answer] …]}`, where an answer
/// is `{:value v}` or `{:failed :offline :message "…"}`. Returns the outcome as EDN:
/// `{:status :done :keep … :show … :asked […]}`, `{:status :needs :request … :asked […]}`
/// or `{:status :failed :reason :offline :message "…" :asked […]}`.
pub fn run_text(action: &str, input: &str) -> String {
    let outcome = match (parse_action(action), read_input(input)) {
        (Ok(a), Ok(i)) => run(&a, &i, Budget::default()),
        (Err(e), _) => Outcome::Failed { reason: "failed".into(), message: e.to_string(), asked: vec![] },
        (_, Err(m)) => Outcome::Failed { reason: "failed".into(), message: m, asked: vec![] },
    };
    print(&outcome_value(&outcome))
}

fn read_input(text: &str) -> Result<Input, String> {
    let v = read(text).map_err(|e| format!("the input: {e}"))?;
    let Value::Map(entries) = v else { return Err("the input is a map".into()) };
    let mut input = Input { request: Value::Nil, ctx: Value::Nil, granted: Needs::default(), answers: vec![] };
    for (k, v) in entries {
        let Value::Keyword(k) = k else { continue };
        match k.as_str() {
            "request" => input.request = v,
            "ctx" => input.ctx = v,
            "granted" => input.granted = Needs::from_value(Some(&v))?,
            "answers" => {
                let (Value::Vector(pairs) | Value::List(pairs)) = v else { return Err(":answers is a list of [request answer]".into()) };
                for pair in pairs {
                    match pair {
                        Value::Vector(mut p) if p.len() == 2 => {
                            let answer = p.pop().unwrap();
                            let request = p.pop().unwrap();
                            input.answers.push((print(&request), answer_of(&answer)?));
                        }
                        _ => return Err(":answers is a list of [request answer]".into()),
                    }
                }
            }
            _ => {}
        }
    }
    Ok(input)
}

fn answer_of(v: &Value) -> Result<Answer, String> {
    let Value::Map(entries) = v else { return Err("an answer is {:value v} or {:failed :offline}".into()) };
    let get = |name: &str| entries.iter().find(|(k, _)| matches!(k, Value::Keyword(k) if k == name)).map(|(_, v)| v);
    if let Some(v) = get("value") {
        return Ok(Answer::Value(v.clone()));
    }
    match get("failed") {
        Some(Value::Keyword(reason)) if ["offline", "timeout", "denied", "error"].contains(&reason.as_str()) => {
            let message = match get("message") {
                Some(Value::Str(s)) => s.clone(),
                _ => String::new(),
            };
            Ok(Answer::Failed(reason.clone(), message))
        }
        _ => Err("an answer is {:value v} or {:failed :offline}; a failure is :offline, :timeout, :denied or :error".into()),
    }
}

fn answer_value(a: &Answer) -> Value {
    match a {
        Answer::Value(v) => Value::Map(vec![(kw("value"), v.clone())]),
        Answer::Failed(reason, message) => {
            Value::Map(vec![(kw("failed"), kw(reason)), (kw("message"), Value::Str(message.clone()))])
        }
    }
}

pub fn outcome_value(o: &Outcome) -> Value {
    let asked = |a: &[(Value, Value)]| Value::Vector(a.iter().map(|(r, x)| Value::Vector(vec![r.clone(), x.clone()])).collect());
    match o {
        Outcome::Done { keep, show, asked: a } => {
            let mut m = vec![(kw("status"), kw("done")), (kw("asked"), asked(a))];
            if let Some(k) = keep {
                m.push((kw("keep"), k.clone()));
            }
            if let Some(s) = show {
                m.push((kw("show"), s.clone()));
            }
            Value::Map(m)
        }
        Outcome::Needs { request, asked: a } => {
            Value::Map(vec![(kw("status"), kw("needs")), (kw("request"), request.clone()), (kw("asked"), asked(a))])
        }
        Outcome::Failed { reason, message, asked: a } => Value::Map(vec![
            (kw("status"), kw("failed")),
            (kw("reason"), kw(reason)),
            (kw("message"), Value::Str(message.clone())),
            (kw("asked"), asked(a)),
        ]),
    }
}

fn kw(name: &str) -> Value {
    Value::Keyword(name.to_string())
}

// ----------------------------------------------------------------------------
// The machine
// ----------------------------------------------------------------------------

/// A value while running: data, or a function, which can be passed but never kept.
#[derive(Debug, Clone)]
enum Val {
    Data(Value),
    Fn(Rc<Closure>),
    Builtin(String),
}

#[derive(Debug)]
struct Closure {
    params: Vec<Value>,
    body: Vec<Value>,
    scope: Scope,
}

/// Names in scope: a chain of frames, innermost first.
#[derive(Debug, Clone, Default)]
struct Scope(Option<Rc<Frame>>);

#[derive(Debug)]
struct Frame {
    name: String,
    value: Val,
    parent: Scope,
}

impl Scope {
    fn with(&self, name: String, value: Val) -> Scope {
        Scope(Some(Rc::new(Frame { name, value, parent: self.clone() })))
    }
    fn get(&self, name: &str) -> Option<Val> {
        let mut at = &self.0;
        while let Some(frame) = at {
            if frame.name == name {
                return Some(frame.value.clone());
            }
            at = &frame.parent.0;
        }
        None
    }
}

enum Stop {
    Needs(Value),
    Failed(String, String),
}

type R<T> = Result<T, Stop>;

fn fail<T>(message: impl Into<String>) -> R<T> {
    Err(Stop::Failed("failed".into(), message.into()))
}

struct Machine<'a> {
    action: &'a Action,
    input: &'a Input,
    budget: Budget,
    steps: u64,
    heap: u64,
    depth: usize,
    asked: Vec<(Value, Value)>,
}

const SPECIAL: &[&str] = &["let", "if", "when", "do", "and", "or", "fn"];

const BUILTINS: &[&str] = &[
    "=", "not=", "<", ">", "<=", ">=", "+", "-", "*", "/", "not", "nil?", "empty?", "count", "first", "second", "last",
    "rest", "nth", "get", "get-in", "assoc", "contains?", "keys", "vals", "vector", "hash-map", "str", "map", "filter",
    "reduce", "sum", "min", "max", "round", "parse-number", "string?", "number?", "map?", "vector?", "concat", "range",
];

impl<'a> Machine<'a> {
    fn call_action(&mut self) -> R<Val> {
        let args = [
            Val::Data(self.input.request.clone()),
            Val::Data(self.input.granted_for(&self.action.needs).to_value()),
            Val::Data(self.input.ctx.clone()),
        ];
        let closure = Closure { params: self.action.params.clone(), body: self.action.body.clone(), scope: Scope::default() };
        self.apply_closure(&closure, args[..closure.params.len()].to_vec())
    }

    fn step(&mut self) -> R<()> {
        self.steps += 1;
        if self.steps > self.budget.steps {
            return Err(Stop::Failed("budget".into(), format!("the action took more than {} steps", self.budget.steps)));
        }
        Ok(())
    }

    fn charge(&mut self, amount: usize) -> R<()> {
        self.heap += amount as u64;
        if self.heap > self.budget.heap {
            return Err(Stop::Failed("budget".into(), format!("the action made more than {} bytes", self.budget.heap)));
        }
        Ok(())
    }

    fn eval_body(&mut self, body: &[Value], scope: &Scope) -> R<Val> {
        let mut last = Val::Data(Value::Nil);
        for form in body {
            last = self.eval(form, scope)?;
        }
        Ok(last)
    }

    fn eval(&mut self, form: &Value, scope: &Scope) -> R<Val> {
        self.step()?;
        self.depth += 1;
        if self.depth > self.budget.depth {
            self.depth -= 1;
            return Err(Stop::Failed("budget".into(), format!("the action nested deeper than {}", self.budget.depth)));
        }
        let result = self.eval_inner(form, scope);
        self.depth -= 1;
        result
    }

    fn eval_inner(&mut self, form: &Value, scope: &Scope) -> R<Val> {
        match form {
            Value::Symbol(name) => {
                if let Some(v) = scope.get(name) {
                    return Ok(v);
                }
                if BUILTINS.contains(&name.as_str()) || name.starts_with("env/") {
                    return Ok(Val::Builtin(name.clone()));
                }
                fail(format!("{name} isn't defined"))
            }
            Value::Vector(items) => {
                let items = self.eval_data(items, scope)?;
                self.charge(items.len())?;
                Ok(Val::Data(Value::Vector(items)))
            }
            Value::Set(items) => {
                let items = self.eval_data(items, scope)?;
                self.charge(items.len())?;
                Ok(Val::Data(Value::Set(dedupe(items))))
            }
            Value::Map(entries) => {
                let mut out = Vec::with_capacity(entries.len());
                for (k, v) in entries {
                    let k = self.eval(k, scope)?;
                    let k = self.data(k)?;
                    let v = self.eval(v, scope)?;
                    let v = self.data(v)?;
                    out.push((k, v));
                }
                self.charge(out.len())?;
                Ok(Val::Data(Value::Map(dedupe_map(out))))
            }
            Value::List(items) if items.is_empty() => Ok(Val::Data(Value::List(vec![]))),
            Value::List(items) => self.eval_list(items, scope),
            Value::Tagged(tag, _) => fail(format!("#{tag} values can't be used in an action")),
            other => Ok(Val::Data(other.clone())),
        }
    }

    fn eval_data(&mut self, items: &[Value], scope: &Scope) -> R<Vec<Value>> {
        let mut out = Vec::with_capacity(items.len());
        for item in items {
            let v = self.eval(item, scope)?;
            out.push(self.data(v)?);
        }
        Ok(out)
    }

    fn data(&self, v: Val) -> R<Value> {
        match v {
            Val::Data(d) => Ok(d),
            _ => fail("a function can't be kept in data"),
        }
    }

    fn eval_list(&mut self, items: &[Value], scope: &Scope) -> R<Val> {
        if let Value::Symbol(head) = &items[0] {
            if SPECIAL.contains(&head.as_str()) && scope.get(head).is_none() {
                return self.special(head, &items[1..], scope);
            }
        }
        let f = self.eval(&items[0], scope)?;
        let mut args = Vec::with_capacity(items.len() - 1);
        for item in &items[1..] {
            args.push(self.eval(item, scope)?);
        }
        self.apply(f, args)
    }

    fn special(&mut self, head: &str, args: &[Value], scope: &Scope) -> R<Val> {
        match head {
            "let" => {
                let Some(Value::Vector(bindings)) = args.first() else { return fail("let takes [name value …] and a body") };
                if bindings.len() % 2 != 0 {
                    return fail("let's bindings come in pairs");
                }
                let mut inner = scope.clone();
                for pair in bindings.chunks(2) {
                    check_pattern(&pair[0]).or_else(|m| fail(m))?;
                    let v = self.eval(&pair[1], &inner)?;
                    inner = self.bind(&pair[0], v, inner)?;
                }
                self.eval_body(&args[1..], &inner)
            }
            "if" => {
                if args.len() < 2 || args.len() > 3 {
                    return fail("if takes a test, a then and an optional else");
                }
                if truthy(&self.eval(&args[0], scope)?) {
                    self.eval(&args[1], scope)
                } else if let Some(e) = args.get(2) {
                    self.eval(e, scope)
                } else {
                    Ok(Val::Data(Value::Nil))
                }
            }
            "when" => {
                let Some(test) = args.first() else { return fail("when takes a test and a body") };
                if truthy(&self.eval(test, scope)?) {
                    self.eval_body(&args[1..], scope)
                } else {
                    Ok(Val::Data(Value::Nil))
                }
            }
            "do" => self.eval_body(args, scope),
            "and" => {
                let mut last = Val::Data(Value::Bool(true));
                for a in args {
                    last = self.eval(a, scope)?;
                    if !truthy(&last) {
                        break;
                    }
                }
                Ok(last)
            }
            "or" => {
                let mut last = Val::Data(Value::Nil);
                for a in args {
                    last = self.eval(a, scope)?;
                    if truthy(&last) {
                        break;
                    }
                }
                Ok(last)
            }
            "fn" => {
                let Some(Value::Vector(params)) = args.first() else { return fail("fn takes [params] and a body") };
                for p in params {
                    check_pattern(p).or_else(|m| fail(m))?;
                }
                Ok(Val::Fn(Rc::new(Closure { params: params.clone(), body: args[1..].to_vec(), scope: scope.clone() })))
            }
            _ => unreachable!(),
        }
    }

    /// Bind a pattern: a name, `_`, `{:keys [a b]}` or `[a b]`.
    fn bind(&mut self, pattern: &Value, v: Val, scope: Scope) -> R<Scope> {
        match pattern {
            Value::Symbol(s) if s == "_" => Ok(scope),
            Value::Symbol(s) => Ok(scope.with(s.clone(), v)),
            Value::Map(entries) => {
                let data = self.data(v)?;
                let mut scope = scope;
                for (k, names) in entries {
                    match (k, names) {
                        (Value::Keyword(k), Value::Vector(names)) if k == "keys" => {
                            for n in names {
                                let Value::Symbol(n) = n else { unreachable!() };
                                scope = scope.with(n.clone(), Val::Data(lookup(&data, &kw(n))));
                            }
                        }
                        (Value::Keyword(k), Value::Symbol(n)) if k == "as" => scope = scope.with(n.clone(), Val::Data(data.clone())),
                        _ => unreachable!(),
                    }
                }
                Ok(scope)
            }
            Value::Vector(names) => {
                let data = self.data(v)?;
                let items = match &data {
                    Value::Vector(xs) | Value::List(xs) => xs.clone(),
                    Value::Nil => vec![],
                    _ => return fail(format!("{} can't be taken apart as a list", print(&data))),
                };
                let mut scope = scope;
                for (i, n) in names.iter().enumerate() {
                    scope = self.bind(n, Val::Data(items.get(i).cloned().unwrap_or(Value::Nil)), scope)?;
                }
                Ok(scope)
            }
            _ => unreachable!(),
        }
    }

    fn apply(&mut self, f: Val, args: Vec<Val>) -> R<Val> {
        match f {
            Val::Fn(c) => self.apply_closure(&c, args),
            Val::Builtin(name) if name.starts_with("env/") => self.env_call(&name[4..], args),
            Val::Builtin(name) => self.call_builtin(&name, args),
            // A keyword looks itself up: (:lat r), (:lat r default).
            Val::Data(k @ Value::Keyword(_)) => {
                let (m, default) = match args.len() {
                    1 => (self.data(args[0].clone())?, Value::Nil),
                    2 => (self.data(args[0].clone())?, self.data(args[1].clone())?),
                    _ => return fail(format!("{} takes a map and an optional default", print(&k))),
                };
                let found = lookup(&m, &k);
                Ok(Val::Data(if found == Value::Nil { default } else { found }))
            }
            Val::Data(other) => fail(format!("{} isn't a function", print(&other))),
        }
    }

    fn apply_closure(&mut self, c: &Closure, args: Vec<Val>) -> R<Val> {
        if args.len() != c.params.len() {
            return fail(format!("a function of {} argument(s) was given {}", c.params.len(), args.len()));
        }
        let mut scope = c.scope.clone();
        for (p, a) in c.params.iter().zip(args) {
            scope = self.bind(p, a, scope)?;
        }
        self.eval_body(&c.body, &scope)
    }

    // ------------------------------------------------------------------------
    // Requests: everything the app performs
    // ------------------------------------------------------------------------

    fn env_call(&mut self, verb: &str, args: Vec<Val>) -> R<Val> {
        let args: Vec<Value> = args.into_iter().map(|a| self.data(a)).collect::<R<_>>()?;
        let granted = self.input.granted_for(&self.action.needs);
        let refused = |m: String| Err(Stop::Failed("refused".into(), m));
        let request = match (verb, args.as_slice()) {
            ("fetch", [Value::Str(url), rest @ ..]) if rest.len() <= 1 => {
                let Some(host) = https_host(url) else { return fail(format!("{url:?} isn't an https:// address")) };
                if !self.action.needs.fetch.iter().any(|h| h == host) {
                    return refused(format!("the action doesn't declare fetching from {host}"));
                }
                if !granted.fetch.iter().any(|h| h == host) {
                    return refused(format!("this device hasn't let the action fetch from {host}"));
                }
                let mut r = vec![(kw("op"), kw("fetch")), (kw("url"), Value::Str(url.clone()))];
                match rest.first() {
                    None => {}
                    Some(q @ Value::Map(_)) => r.push((kw("query"), q.clone())),
                    Some(_) => return fail("env/fetch takes an address and an optional map of query parameters"),
                }
                Value::Map(r)
            }
            ("read", [Value::Str(path)]) => {
                if !self.action.needs.read.contains(path) {
                    return refused(format!("the action doesn't declare reading {path}"));
                }
                if !granted.read.contains(path) {
                    return refused(format!("this device hasn't let the action read {path}"));
                }
                Value::Map(vec![(kw("op"), kw("read")), (kw("path"), Value::Str(path.clone()))])
            }
            ("now", []) => Value::Map(vec![(kw("op"), kw("now"))]),
            ("format", [Value::Keyword(kind), v]) => {
                Value::Map(vec![(kw("op"), kw("format")), (kw("as"), kw(kind)), (kw("value"), v.clone())])
            }
            ("locate", []) => {
                if !(self.action.needs.locate && granted.locate) {
                    return refused("the action may not ask where this device is".into());
                }
                Value::Map(vec![(kw("op"), kw("locate"))])
            }
            ("ask", [question, rest @ ..]) if rest.len() <= 1 => {
                if !(self.action.needs.ask && granted.ask) {
                    return refused("the action may not ask questions on screen".into());
                }
                let mut r = vec![(kw("op"), kw("ask")), (kw("question"), question.clone())];
                if let Some(choices) = rest.first() {
                    r.push((kw("choices"), choices.clone()));
                }
                Value::Map(r)
            }
            ("fetch" | "read" | "now" | "format" | "locate" | "ask", _) => {
                return fail(format!("env/{verb} was given the wrong arguments"))
            }
            _ => return fail(format!("env/{verb} isn't something an action can ask for")),
        };
        let key = print(&request);
        match self.input.answers.iter().find(|(k, _)| *k == key) {
            None => Err(Stop::Needs(request)),
            Some((_, answer)) => {
                if !self.asked.iter().any(|(r, _)| print(r) == key) {
                    if self.asked.len() >= self.budget.requests {
                        return Err(Stop::Failed("budget".into(), format!("the action asked for more than {} things", self.budget.requests)));
                    }
                    self.asked.push((request.clone(), answer_value(answer)));
                }
                match answer {
                    Answer::Value(v) => {
                        self.charge(print(v).len())?;
                        Ok(Val::Data(v.clone()))
                    }
                    Answer::Failed(reason, message) => Err(Stop::Failed(reason.clone(), message.clone())),
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // Built-ins
    // ------------------------------------------------------------------------

    fn call_builtin(&mut self, name: &str, args: Vec<Val>) -> R<Val> {
        // Functions that take a function.
        match name {
            "map" | "filter" => {
                let [f, xs] = <[Val; 2]>::try_from(args).or_else(|_| fail(format!("{name} takes a function and a list")))?;
                let xs = self.items(self.data(xs)?)?;
                let mut out = Vec::with_capacity(xs.len());
                for x in xs {
                    let r = self.apply(f.clone(), vec![Val::Data(x.clone())])?;
                    if name == "map" {
                        out.push(self.data(r)?);
                    } else if truthy(&r) {
                        out.push(x);
                    }
                }
                self.charge(out.len())?;
                return Ok(Val::Data(Value::Vector(out)));
            }
            "reduce" => {
                let (f, init, xs) = match args.len() {
                    2 => {
                        let xs = self.items(self.data(args[1].clone())?)?;
                        let mut it = xs.into_iter();
                        let init = it.next().unwrap_or(Value::Nil);
                        (args[0].clone(), init, it.collect::<Vec<_>>())
                    }
                    3 => (args[0].clone(), self.data(args[1].clone())?, self.items(self.data(args[2].clone())?)?),
                    _ => return fail("reduce takes a function, an optional start and a list"),
                };
                let mut acc = Val::Data(init);
                for x in xs {
                    acc = self.apply(f.clone(), vec![acc, Val::Data(x)])?;
                }
                return Ok(acc);
            }
            _ => {}
        }
        let args: Vec<Value> = args.into_iter().map(|a| self.data(a)).collect::<R<_>>()?;
        let v = match (name, args.as_slice()) {
            ("=", [a, rest @ ..]) => Value::Bool(rest.iter().all(|b| equal(a, b))),
            ("not=", [a, b]) => Value::Bool(!equal(a, b)),
            ("<" | ">" | "<=" | ">=", [_, _, ..]) => {
                let ns = args.iter().map(number).collect::<R<Vec<_>>>()?;
                Value::Bool(ns.windows(2).all(|w| match name {
                    "<" => w[0] < w[1],
                    ">" => w[0] > w[1],
                    "<=" => w[0] <= w[1],
                    _ => w[0] >= w[1],
                }))
            }
            ("+" | "*", _) => arithmetic(name, &args)?,
            ("-" | "/", [_, ..]) => arithmetic(name, &args)?,
            ("not", [a]) => Value::Bool(!truthy_value(a)),
            ("nil?", [a]) => Value::Bool(*a == Value::Nil),
            ("string?", [a]) => Value::Bool(matches!(a, Value::Str(_))),
            ("number?", [a]) => Value::Bool(matches!(a, Value::Int(_) | Value::Float(_))),
            ("map?", [a]) => Value::Bool(matches!(a, Value::Map(_))),
            ("vector?", [a]) => Value::Bool(matches!(a, Value::Vector(_))),
            ("empty?", [a]) => Value::Bool(match a {
                Value::Nil => true,
                Value::Str(s) => s.is_empty(),
                Value::Map(m) => m.is_empty(),
                other => self.items(other.clone())?.is_empty(),
            }),
            ("count", [a]) => Value::Int(match a {
                Value::Nil => 0,
                Value::Str(s) => s.chars().count(),
                Value::Map(m) => m.len(),
                other => self.items(other.clone())?.len(),
            } as i64),
            ("first", [a]) => self.items(a.clone())?.into_iter().next().unwrap_or(Value::Nil),
            ("second", [a]) => self.items(a.clone())?.into_iter().nth(1).unwrap_or(Value::Nil),
            ("last", [a]) => self.items(a.clone())?.pop().unwrap_or(Value::Nil),
            ("rest", [a]) => Value::Vector(self.items(a.clone())?.into_iter().skip(1).collect()),
            ("nth", [a, Value::Int(i)]) => self.items(a.clone())?.into_iter().nth(*i as usize).unwrap_or(Value::Nil),
            ("get", [m, k]) => lookup(m, k),
            ("get", [m, k, default]) => match lookup(m, k) {
                Value::Nil => default.clone(),
                v => v,
            },
            ("get-in", [m, Value::Vector(path)]) => path.iter().fold(m.clone(), |at, k| lookup(&at, k)),
            ("contains?", [Value::Map(m), k]) => Value::Bool(m.iter().any(|(mk, _)| equal(mk, k))),
            ("contains?", [Value::Set(s), k]) => Value::Bool(s.iter().any(|x| equal(x, k))),
            ("keys", [Value::Map(m)]) => Value::Vector(m.iter().map(|(k, _)| k.clone()).collect()),
            ("vals", [Value::Map(m)]) => Value::Vector(m.iter().map(|(_, v)| v.clone()).collect()),
            ("assoc", [Value::Map(_) | Value::Nil, rest @ ..]) if rest.len() % 2 == 0 && !rest.is_empty() => {
                let mut out = if let Value::Map(m) = &args[0] { m.clone() } else { vec![] };
                for pair in rest.chunks(2) {
                    out.retain(|(k, _)| !equal(k, &pair[0]));
                    out.push((pair[0].clone(), pair[1].clone()));
                }
                Value::Map(out)
            }
            ("vector", xs) => Value::Vector(xs.to_vec()),
            ("hash-map", xs) if xs.len() % 2 == 0 => Value::Map(dedupe_map(xs.chunks(2).map(|p| (p[0].clone(), p[1].clone())).collect())),
            ("concat", xs) => {
                let mut out = vec![];
                for x in xs {
                    out.extend(self.items(x.clone())?);
                }
                Value::Vector(out)
            }
            ("range", [Value::Int(n)]) if *n >= 0 => {
                self.charge(*n as usize)?;
                Value::Vector((0..*n).map(Value::Int).collect())
            }
            ("str", xs) => {
                let mut s = String::new();
                for x in xs {
                    s.push_str(&text(x));
                }
                self.charge(s.len())?;
                Value::Str(s)
            }
            // Skips empty values, as `.table`'s sum does.
            ("sum", [xs]) => {
                let ns: Vec<Value> = self.items(xs.clone())?.into_iter().filter(|x| !matches!(x, Value::Nil) && *x != Value::Str(String::new())).collect();
                arithmetic("+", &ns)?
            }
            ("min" | "max", [_, ..]) => {
                let mut best = args[0].clone();
                for x in &args[1..] {
                    let (a, b) = (number(&best)?, number(x)?);
                    if (name == "min" && b < a) || (name == "max" && b > a) {
                        best = x.clone();
                    }
                }
                number(&best)?;
                best
            }
            ("round", [x]) => match x {
                Value::Int(_) => x.clone(),
                _ => float_or_int(number(x)?.round()),
            },
            ("round", [x, Value::Int(places)]) if (0..=15).contains(places) => {
                let scale = 10f64.powi(*places as i32);
                Value::Float((number(x)? * scale).round() / scale)
            }
            // Text to a number, as a fetched JSON value often is ("53.3498"); nil when it isn't one.
            ("parse-number", [Value::Str(s)]) => match s.trim().parse::<i64>() {
                Ok(i) => Value::Int(i),
                Err(_) => match s.trim().parse::<f64>() {
                    Ok(f) if f.is_finite() => Value::Float(f),
                    _ => Value::Nil,
                },
            },
            ("parse-number", [n @ (Value::Int(_) | Value::Float(_))]) => n.clone(),
            ("parse-number", [_]) => Value::Nil,
            _ => return fail(format!("{name} can't take {}", args.iter().map(print).collect::<Vec<_>>().join(" "))),
        };
        Ok(Val::Data(v))
    }

    fn items(&self, v: Value) -> R<Vec<Value>> {
        match v {
            Value::Vector(xs) | Value::List(xs) | Value::Set(xs) => Ok(xs),
            Value::Nil => Ok(vec![]),
            Value::Map(entries) => Ok(entries.into_iter().map(|(k, v)| Value::Vector(vec![k, v])).collect()),
            other => fail(format!("{} isn't a list", print(&other))),
        }
    }
}

impl Input {
    /// What this device grants, within what the action declares.
    fn granted_for(&self, declared: &Needs) -> Needs {
        Needs {
            fetch: declared.fetch.iter().filter(|h| self.granted.fetch.contains(h)).cloned().collect(),
            read: declared.read.iter().filter(|p| self.granted.read.contains(p)).cloned().collect(),
            locate: declared.locate && self.granted.locate,
            ask: declared.ask && self.granted.ask,
        }
    }
}

/// A pattern `bind` takes; checked when the action is read, so binding never meets another.
fn check_pattern(p: &Value) -> Result<(), String> {
    match p {
        Value::Symbol(s) if !s.contains('/') && !SPECIAL.contains(&s.as_str()) => Ok(()),
        Value::Vector(xs) => xs.iter().try_for_each(check_pattern),
        Value::Map(entries) => entries.iter().try_for_each(|(k, v)| match (k, v) {
            (Value::Keyword(k), Value::Vector(names)) if k == "keys" => names.iter().try_for_each(|n| match n {
                Value::Symbol(s) if !s.contains('/') => Ok(()),
                _ => Err("{:keys [...]} names symbols".to_string()),
            }),
            (Value::Keyword(k), Value::Symbol(_)) if k == "as" => Ok(()),
            _ => Err("a map pattern is {:keys [a b]} with an optional :as".to_string()),
        }),
        other => Err(format!("{} can't name a value", print(other))),
    }
}

/// The host of an `https://` address, without a port or user.
fn https_host(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..end];
    if host.is_empty() || host.contains('@') || host.contains(':') {
        return None;
    }
    Some(host)
}

fn truthy(v: &Val) -> bool {
    match v {
        Val::Data(d) => truthy_value(d),
        _ => true,
    }
}

fn truthy_value(v: &Value) -> bool {
    !matches!(v, Value::Nil | Value::Bool(false))
}

/// Equal as values: maps and sets regardless of order, `1` and `1.0` not (as EDN has them).
fn equal(a: &Value, b: &Value) -> bool {
    print(a) == print(b)
}

fn lookup(m: &Value, k: &Value) -> Value {
    match (m, k) {
        (Value::Map(entries), _) => entries.iter().find(|(mk, _)| equal(mk, k)).map(|(_, v)| v.clone()).unwrap_or(Value::Nil),
        (Value::Vector(xs), Value::Int(i)) if *i >= 0 => xs.get(*i as usize).cloned().unwrap_or(Value::Nil),
        _ => Value::Nil,
    }
}

fn dedupe(items: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(items.len());
    for x in items {
        if !out.iter().any(|y| equal(y, &x)) {
            out.push(x);
        }
    }
    out
}

/// A later entry with the same key wins, as `assoc` would.
fn dedupe_map(entries: Vec<(Value, Value)>) -> Vec<(Value, Value)> {
    let mut out: Vec<(Value, Value)> = Vec::with_capacity(entries.len());
    for (k, v) in entries {
        out.retain(|(ok, _)| !equal(ok, &k));
        out.push((k, v));
    }
    out
}

/// A value as `str` writes it: text as itself, nil as nothing, anything else printed.
fn text(v: &Value) -> String {
    match v {
        Value::Str(s) => s.clone(),
        Value::Nil => String::new(),
        Value::Char(c) => c.to_string(),
        other => print(other),
    }
}

fn number(v: &Value) -> R<f64> {
    match v {
        Value::Int(i) => Ok(*i as f64),
        Value::Float(f) => Ok(*f),
        other => fail(format!("{} isn't a number", print(other))),
    }
}

fn float_or_int(f: f64) -> Value {
    if f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 {
        Value::Int(f as i64)
    } else {
        Value::Float(f)
    }
}

/// Integers stay integers (refusing overflow); a float anywhere makes a float. `/` always divides as floats.
fn arithmetic(op: &str, args: &[Value]) -> R<Value> {
    let ints: Option<Vec<i64>> = args.iter().map(|a| if let Value::Int(i) = a { Some(*i) } else { None }).collect();
    if let (Some(ints), true) = (ints, op != "/") {
        let overflow = || fail::<Value>("the number is too large");
        let mut acc: i64 = match (op, ints.as_slice()) {
            ("+", []) => return Ok(Value::Int(0)),
            ("*", []) => return Ok(Value::Int(1)),
            ("-", [x]) => return x.checked_neg().map(Value::Int).map_or_else(overflow, Ok),
            _ => ints[0],
        };
        for x in &ints[1..] {
            let next = match op {
                "+" => acc.checked_add(*x),
                "-" => acc.checked_sub(*x),
                _ => acc.checked_mul(*x),
            };
            acc = match next {
                Some(n) => n,
                None => return overflow(),
            };
        }
        return Ok(Value::Int(acc));
    }
    let ns = args.iter().map(number).collect::<R<Vec<_>>>()?;
    let result = match (op, ns.as_slice()) {
        ("+", _) => ns.iter().sum(),
        ("*", _) => ns.iter().product(),
        ("-", [x]) => -x,
        ("/", [x]) => 1.0 / x,
        _ => ns[1..].iter().fold(ns[0], |acc, x| match op {
            "-" => acc - x,
            _ => acc / x,
        }),
    };
    if !result.is_finite() {
        return fail(if op == "/" { "division by zero" } else { "the number is too large" });
    }
    Ok(Value::Float(result))
}
