// Every problem a table has, in one list (SPEC section 9, "Showing a table's
// problems"): what section 9 says makes it invalid, what its reader kept but
// couldn't use, and the optional warnings. Each has a stable code, where it
// is, how much it matters, and the fixes that apply, as data: an app draws
// them its own way, and nothing changes until a person chooses one.

import { cellFormulas } from "./cells.js";
import { enumValues, type Field, type ParsedBundle, type ParsedTable, type Row, type TableSchema, type ValidationError } from "./types.js";
import { valueMessage, valueProblems, type ValueProblem } from "./validator.js";

export type ProblemCode =
  // Section 9: the table isn't valid.
  | "id.missing"
  | "id.repeated"
  | "value.required"
  | "value.type"
  | "value.choice"
  | "value.minimum"
  | "value.maximum"
  | "value.exclusive-minimum"
  | "value.exclusive-maximum"
  | "value.min-length"
  | "value.max-length"
  | "value.pattern"
  | "value.unique"
  | "key.primary"
  | "key.unique"
  | "body.orphaned"
  | "cell.no-row"
  | "cell.no-field"
  | "field.id-repeated"
  // What the reader kept and couldn't use (section 3, "Reader error contract").
  | "line.not-json"
  | "line.not-row"
  | "line.conflict-marker"
  | "line.id-repeated"
  | "line.repeat-left-out"
  | "cell.repeated"
  | "cell.typed-over"
  | "cell.line-unreadable"
  | "file.malformed"
  | "bundle.not-a-table"
  // Section 9's optional warnings.
  | "relation.dangling"
  | "choice.unused"
  | "attachment.orphaned"
  // Rows held in the index: checked as the index was made (#867), not checked, or not since an edit.
  | "rows.not-checked"
  | "rows.not-checked-since-edit"
  | "rows.checking"
  | "rows.more-problems"
  | "rows.links-not-checked";

/**
 * - `error`: section 9 says the table isn't valid, or a line was kept that
 *   a person has to resolve.
 * - `warning`: nothing is lost or invalid, but something points nowhere.
 * - `notice`: the reader said something and lost nothing.
 */
export type Severity = "error" | "warning" | "notice";

/** Where a problem is. */
export type ProblemPlace =
  | { kind: "cell"; row: string; field: string }
  | { kind: "row"; row: string }
  | { kind: "field"; field: string }
  /** A line of `rows/` or `cells/` the reader kept as it was: its file from the table's folder, its zero-based line, its text. */
  | { kind: "line"; file: string; line: number; text: string }
  /** A file, from the table's folder (from the bundle's, for a bundle's own problem). */
  | { kind: "file"; path: string }
  | { kind: "table" };

/**
 * A change a person can choose. `label` says it in a few plain words;
 * `changesSchema` is true when it changes a field or the schema, and so
 * every row. Applying one is one edit, undone and synced as any other.
 */
export type Fix = { label: string; changesSchema: boolean } & (
  | { kind: "set-value"; row: string; field: string; value: unknown }
  | { kind: "clear-value"; row: string; field: string }
  /** Change the field: `change` is merged into it (`constraints` merged into its constraints; an `undefined` member removed). */
  | { kind: "change-field"; field: string; change: Partial<Field> }
  /** Change the schema's own keys (`primaryKey`, `uniqueKeys`); an `undefined` member is removed. */
  | { kind: "change-schema"; change: Partial<TableSchema> }
  /** Keep this kept line as the row with its id, in place of the one read first; that one is kept as the line was. */
  | { kind: "choose-line"; file: string; line: number }
  /** Make a kept line a row of its own, with a new id. */
  | { kind: "keep-as-new-row"; file: string; line: number }
  | { kind: "remove-line"; file: string; line: number }
  /** Remove a cell's formula; its value, if any, stays. `repeats` removes only the lines after the first. */
  | { kind: "remove-formula"; row: string; field: string; repeats?: true }
  /** Give this field a new id. The reader already has; saving keeps it. */
  | { kind: "give-field-new-id"; field: string }
  /** Give an orphaned page (by the row id its name holds) to a row the person picks. */
  | { kind: "attach-page"; page: string }
  | { kind: "remove-page"; page: string }
  /** Remove a file of the table's, by its path from the table's folder. */
  | { kind: "remove-file"; path: string }
);

export interface Problem {
  code: ProblemCode;
  severity: Severity;
  /** The table's name in its bundle; "" for the bundle's own. */
  table: string;
  at: ProblemPlace;
  /** The other side: the rows that hold the same value or key. */
  others?: ProblemPlace[];
  /** What it was checked against and what was found, by stable keys (`constraint`, `limit`, `value`, `expected`, `got`…). */
  details: Record<string, string | number | boolean | null>;
  /** In English, for logs and plain demos: an app writes its own from `code` and `details`. */
  message: string;
  /** The fixes that apply, safest first; empty when only a person's editing can mend it. */
  fixes: Fix[];
}

/** What a table's reader can't know by itself. */
export interface ProblemContext {
  /** The bundle, to follow links to its other tables. */
  bundle?: ParsedBundle;
  /** The names of the files in the table's `attachments/`, to find ones no row holds. Absent: not checked. */
  attachments?: readonly string[];
}

const SEVERITY: Partial<Record<ProblemCode, Severity>> = {
  "line.repeat-left-out": "notice",
  "cell.typed-over": "notice",
  "rows.not-checked": "notice",
  "rows.not-checked-since-edit": "notice",
  "rows.more-problems": "notice",
  "rows.checking": "notice",
  "rows.links-not-checked": "notice",
  "cell.repeated": "warning",
  "bundle.not-a-table": "warning",
  "relation.dangling": "warning",
  "choice.unused": "warning",
  "attachment.orphaned": "warning",
};
const severityOf = (code: ProblemCode): Severity => SEVERITY[code] ?? "error";

/**
 * A large table's rows checked once its index is made (#867, step 2c): what
 * foundInRows finds of them, with no relation followed (a target's rows are
 * another table's, which the check doesn't read). How many problems of each
 * kind, the first of them, and the lines of the rows those are of, for their
 * fixes. Kept with the index, and said by `problemsOf` while the table is as
 * it was checked.
 */
export interface IndexCheck {
  /** The engine's version of what a check finds; a check from another reads as not checked. */
  rules: number;
  /** What it was checked against (`checkStamp`): a table whose schema or pages have changed since reads as not checked since. */
  stamp: string;
  /** Its rows were edited since. */
  stale?: true;
  rows: number;
  total: number;
  counts: Partial<Record<ProblemCode, number>>;
  found: Found[];
  /** The rows the problems in `found` are of, as their lines. */
  lines: string[];
  /** Where each row its problems name is among the table's rows, from 0, by id (a check from before these were kept has none). */
  at?: Record<string, number>;
  /** The files of `attachments/` it was checked against, when they were known. */
  attachments?: string[];
  /** Its relation fields, when it has any: their links weren't checked (a target's rows are another table's). */
  links?: string[];
}

/** What a check of a table's rows reads besides them: the schema's rules, and which rows have pages. */
export function checkStamp(table: Pick<ParsedTable, "schema" | "bodies">): string {
  const { schema } = table;
  const text = JSON.stringify([
    schema.fields.map((f) => [f.name, f.type ?? "string", !!f.computed, f.relation?.cardinality === "many", !!f.attachment, f.constraints ?? null, enumValues(f)]),
    schema.primaryKey ?? null,
    schema.uniqueKeys ?? null,
    Object.keys(table.bodies ?? {}).sort(),
  ]);
  // FNV-1a, twice over, for a stamp short enough to keep.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return `${text.length}:${a.toString(16)}:${b.toString(16)}`;
}

/** How a check kept with an index stands now: usable, under way, made before an edit, or none to go by. */
export function checkState(table: ParsedTable, context: ProblemContext = {}): { check: IndexCheck } | "checking" | "since-edit" | "none" {
  const check = table.indexed?.checked;
  if (!check) return "none";
  if (check === "checking") return "checking";
  if (check.stale || check.stamp !== checkStamp(table)) return "since-edit";
  // Attachments checked against other files than these: not what's there now.
  if (context.attachments && JSON.stringify(check.attachments ?? null) !== JSON.stringify(context.attachments)) return "since-edit";
  return { check };
}

/** How many of a check's problems are errors. */
export function checkErrors(check: Pick<IndexCheck, "counts">): number {
  let n = 0;
  for (const [code, count] of Object.entries(check.counts)) if (severityOf(code as ProblemCode) === "error") n += count ?? 0;
  return n;
}

/** The diagnostics `validate` also finds: taken from there, with their places. */
const FOUND_AGAIN = new Set(["cell.no-row", "cell.no-field"]);

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
const show = (v: unknown) => (typeof v === "string" ? `“${v}”` : JSON.stringify(v));

/** Every problem in a bundle: its own, then each table's, in its order. */
export function tableProblems(bundle: ParsedBundle, attachments: Record<string, readonly string[]> = {}): Problem[] {
  const out: Problem[] = [];
  for (const d of bundle.diagnostics ?? []) out.push(fromDiagnostic(d, ""));
  const names = bundle.meta.tables?.filter((n) => bundle.tables[n]) ?? [];
  for (const n of Object.keys(bundle.tables)) if (!names.includes(n)) names.push(n);
  for (const name of names) {
    const files = attachments[name] ?? attachmentsHeld(bundle, name);
    out.push(...problemsOf(bundle.tables[name]!, name, { bundle, ...(files ? { attachments: files } : {}) }));
  }
  return out;
}

/** The files of a table's `attachments/` a single file carries; undefined for a folder, whose aren't read. */
function attachmentsHeld(bundle: ParsedBundle, name: string): string[] | undefined {
  if (!bundle.files) return undefined;
  const at = `tables/${name}/attachments/`;
  return Object.keys(bundle.files).filter((p) => p.startsWith(at) && !p.slice(at.length).includes("/")).map((p) => p.slice(at.length));
}

/** Every problem in one table. */
export function problemsOf(table: ParsedTable, name: string, context: ProblemContext = {}): Problem[] {
  const out: Problem[] = [];
  const { schema, rows } = table;
  const fields = new Map(schema.fields.map((f) => [f.name, f]));
  const push = (code: ProblemCode, at: ProblemPlace, message: string, details: Problem["details"] = {}, fixes: Fix[] = [], others?: ProblemPlace[]) =>
    out.push({ code, severity: severityOf(code), table: name, at, ...(others ? { others } : {}), details, message, fixes });

  // What the reader said, but what validating finds again below.
  for (const d of table.diagnostics ?? []) if (!FOUND_AGAIN.has(d.code ?? "")) out.push(fromDiagnostic(d, name));

  const unchecked = table.indexed !== undefined || table.loading !== undefined;
  const state = table.indexed ? checkState(table, context) : "none";
  if (state === "checking") {
    push("rows.checking", { kind: "table" }, "A table this large is read through its index, and its rows are being checked against the schema.");
  } else if (state === "since-edit") {
    push("rows.not-checked-since-edit", { kind: "table" }, "A table this large is read through its index. Its rows were checked against the schema once the index was made, and haven't been since they or the schema were edited.");
  } else if (unchecked && state === "none") {
    push("rows.not-checked", { kind: "table" }, "A table this large is read through its index, and its rows aren't checked against the schema one by one.");
  }

  // Two fields with one id, in a schema held (one read has none: the reader said so above).
  const fieldIds = new Map<string, string>();
  for (const f of schema.fields) {
    if (typeof f.id !== "string") continue;
    const first = fieldIds.get(f.id);
    if (first !== undefined) push("field.id-repeated", { kind: "field", field: f.name }, `field ${f.name} has the id ${f.id}, which ${first} has`, { id: f.id, other: first }, [{ kind: "give-field-new-id", field: f.name, label: `Give ${f.name} its own id`, changesSchema: true }]);
    else fieldIds.set(f.id, f.name);
  }

  // The cells, then each row's values (a cell with its own formula is checked as a computed field's is: not at all).
  const ids = new Set(rows.map((r) => r.id));
  for (const c of table.cells ?? []) {
    const fix: Fix = { kind: "remove-formula", row: c.id, field: c.field, label: "Remove the formula", changesSchema: false };
    if (!ids.has(c.id)) {
      if (!unchecked) push("cell.no-row", { kind: "cell", row: c.id, field: c.field }, `cells/ has a formula for row ${c.id}, which isn't there`, { row: c.id, field: c.field }, [fix]);
    } else if (!fields.has(c.field) || c.field === "id") push("cell.no-field", { kind: "cell", row: c.id, field: c.field }, `cells/ has a formula for field ${c.field}, which isn't there`, { row: c.id, field: c.field }, [fix]);
  }
  if (!unchecked) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const f of foundInRows(table, context)) out.push(problemOf(f, table, name, (id) => byId.get(id)));
  } else if (typeof state === "object") {
    // Checked as its index was made: the first of its problems, and how many there are.
    const { check } = state;
    const byId = new Map(check.lines.map((line) => JSON.parse(line) as Row).map((r) => [r.id, r]));
    // Without the files of attachments/ to go by, a file no row holds isn't said (as foundInRows doesn't).
    const left = context.attachments ? 0 : (check.counts["attachment.orphaned"] ?? 0);
    const found = left > 0 ? check.found.filter((f) => f.code !== "attachment.orphaned") : check.found;
    for (const f of found) out.push(problemOf(f, table, name, (id) => byId.get(id)));
    const total = check.total - left;
    if (total > found.length) {
      push("rows.more-problems", { kind: "table" }, `${found.length.toLocaleString("en")} of its ${total.toLocaleString("en")} problems are listed: the first, in the order its rows have them.`, { shown: found.length, total });
    }
    if (check.links?.length) {
      push("rows.links-not-checked", { kind: "table" }, `Its links to other tables (${check.links.join(", ")}) weren't checked: their rows are another table's.`, { fields: check.links.join(",") });
    }
  }
  return out;
}

/**
 * A problem as found in a table's rows, before its words and fixes: what
 * `problemOf` makes a Problem of. The engine finds these too, for a table it
 * holds (#867), and the words and fixes are made here for both.
 */
export interface Found {
  code: ProblemCode;
  /** Its row: a cell's, a row's, or the page's id for an orphaned page. */
  row?: string;
  field?: string;
  details: Problem["details"];
  /** The row that holds the same value or key first. */
  other?: string;
  /** Which key: its place among the primary key and then the unique keys. */
  key?: number;
}

/** The keys a table's rows are checked against, in order: its primary key, then its unique keys. */
function keysOf(schema: TableSchema): { code: "key.primary" | "key.unique"; fields: string[]; emptyCounts: boolean }[] {
  return [
    ...(schema.primaryKey?.length ? [{ code: "key.primary" as const, fields: schema.primaryKey, emptyCounts: true }] : []),
    ...(schema.uniqueKeys ?? []).filter((k) => Array.isArray(k) && k.length > 0).map((fields) => ({ code: "key.unique" as const, fields, emptyCounts: false })),
  ];
}

/** Every problem in a table's rows, its pages and its optional warnings, in order: what `problemsOf` gives of them. */
export function foundInRows(table: ParsedTable, context: ProblemContext = {}): Found[] {
  const out: Found[] = [];
  const { schema, rows } = table;
  const own = cellFormulas(schema, rows, table.cells);
  const seenIds = new Set<string>();
  const uniques = schema.fields.filter((f) => f.constraints?.unique && !f.computed).map((f) => ({ field: f, seen: new Map<string, Row>() }));
  const keys = keysOf(schema).map((k) => ({ ...k, seen: new Map<string, Row>() }));

  for (const row of rows) {
    if (typeof row.id !== "string" || row.id === "") {
      out.push({ code: "id.missing", details: {} });
      continue;
    }
    if (seenIds.has(row.id)) out.push({ code: "id.repeated", row: row.id, details: { id: row.id } });
    seenIds.add(row.id);

    for (const field of schema.fields) {
      if (field.computed || own.get(row.id)?.has(field.name)) continue;
      for (const p of valueProblems(field, row[field.name])) out.push({ code: p.code, row: row.id, field: field.name, details: p.details });
    }

    for (const u of uniques) {
      const value = row[u.field.name];
      if (isEmpty(value)) continue;
      const key = JSON.stringify(value);
      const first = u.seen.get(key);
      if (!first) u.seen.set(key, row);
      else out.push({ code: "value.unique", row: row.id, field: u.field.name, details: { field: u.field.name, value: key, other: first.id }, other: first.id });
    }

    keys.forEach((k, at) => {
      const values = k.fields.map((f) => row[f]);
      if (!k.emptyCounts && values.some(isEmpty)) return;
      const key = values.map((v) => JSON.stringify(v)).join("\u0000");
      const first = k.seen.get(key);
      if (!first) k.seen.set(key, row);
      else out.push({ code: k.code, row: row.id, details: { fields: k.fields.join(","), other: first.id }, other: first.id, key: at });
    });
  }

  // A page whose row isn't there.
  if (table.bodies) {
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Object.keys(table.bodies)) if (!ids.has(id)) out.push({ code: "body.orphaned", row: id, details: { row: id } });
  }

  for (const field of schema.fields) {
    // A link to a table in the bundle that has no row with that id. Another file's rows aren't read here.
    const target = field.relation ? context.bundle?.tables[field.relation.table] : undefined;
    if (target && target.indexed === undefined && target.loading === undefined) {
      const there = new Set(target.rows.map((r) => r.id));
      for (const row of rows) {
        const value = row[field.name];
        for (const id of Array.isArray(value) ? value : [value]) {
          if (typeof id !== "string" || id === "" || there.has(id)) continue;
          out.push({ code: "relation.dangling", row: row.id, field: field.name, details: { field: field.name, table: field.relation!.table, value: id } });
        }
      }
    }
    // A choice no row has.
    const choices = enumValues(field);
    if (choices.length > 0 && !field.computed) {
      const used = new Set<unknown>();
      for (const row of rows) {
        const v = row[field.name];
        for (const item of Array.isArray(v) ? v : [v]) used.add(item);
      }
      for (const choice of choices) if (!used.has(choice)) out.push({ code: "choice.unused", field: field.name, details: { field: field.name, value: choice } });
    }
  }
  // A file in attachments/ no row's attachment field holds.
  if (context.attachments) {
    const held = new Set<unknown>();
    for (const field of schema.fields.filter((f) => f.attachment)) for (const row of rows) held.add(row[field.name]);
    for (const file of context.attachments) if (!held.has(file)) out.push({ code: "attachment.orphaned", details: { file } });
  }
  return out;
}

/** A problem found, with its place, its words and its fixes. `rowOf` gives a row by id, for fixes that read its value. */
export function problemOf(f: Found, table: Pick<ParsedTable, "schema">, name: string, rowOf: (id: string) => Row | undefined): Problem {
  const { schema } = table;
  const make = (at: ProblemPlace, message: string, details: Problem["details"] = f.details, fixes: Fix[] = [], others?: ProblemPlace[]): Problem => ({
    code: f.code,
    severity: severityOf(f.code),
    table: name,
    at,
    ...(others ? { others } : {}),
    details,
    message,
    fixes,
  });
  const field = f.field !== undefined ? schema.fields.find((x) => x.name === f.field) : undefined;
  const row = f.row !== undefined ? rowOf(f.row) : undefined;
  switch (f.code) {
    case "id.missing":
      return make({ kind: "table" }, "a row has no id");
    case "id.repeated":
      return make({ kind: "row", row: f.row! }, `two rows have the id ${f.row}`);
    case "value.unique": {
      const value = row?.[f.field!];
      return make({ kind: "cell", row: f.row!, field: f.field! }, `${f.field} must be unique: row ${f.other} has ${show(value)} too`, f.details, [
        { kind: "clear-value", row: f.row!, field: f.field!, label: "Clear it in this row", changesSchema: false },
        { kind: "change-field", field: f.field!, change: { constraints: { ...field!.constraints, unique: undefined } }, label: `Allow repeats in ${f.field}`, changesSchema: true },
      ], [{ kind: "cell", row: f.other!, field: f.field! }]);
    }
    case "key.primary":
    case "key.unique": {
      const k = keysOf(schema)[f.key!]!;
      const words = f.code === "key.primary" ? "primary key" : "unique key";
      const change: Partial<TableSchema> = f.code === "key.primary" ? { primaryKey: undefined } : { uniqueKeys: (schema.uniqueKeys ?? []).filter((u) => u !== k.fields) };
      return make({ kind: "row", row: f.row! }, `${words} [${k.fields.join(", ")}] is the same as row ${f.other}'s`, f.details, [
        { kind: "change-schema", change, label: `Stop requiring ${k.fields.join(" and ")} to be different in every row`, changesSchema: true },
      ], [{ kind: "row", row: f.other! }]);
    }
    case "body.orphaned":
      return make({ kind: "row", row: f.row! }, `the page for row ${f.row} has no row`, f.details, [
        { kind: "attach-page", page: f.row!, label: "Give it to a row", changesSchema: false },
        { kind: "remove-page", page: f.row!, label: "Delete the page", changesSchema: false },
      ]);
    case "relation.dangling": {
      const value = row?.[f.field!];
      const id = f.details["value"] as string;
      const fix: Fix = Array.isArray(value)
        ? { kind: "set-value", row: f.row!, field: f.field!, value: value.filter((v) => v !== id), label: "Remove the link", changesSchema: false }
        : { kind: "clear-value", row: f.row!, field: f.field!, label: "Clear the link", changesSchema: false };
      return make({ kind: "cell", row: f.row!, field: f.field! }, `${f.field} links to ${id}, which isn't in ${field!.relation!.table}`, f.details, [fix]);
    }
    case "choice.unused": {
      const choice = f.details["value"] as string;
      const remove = (list: readonly (string | { value: string })[]) => list.filter((e) => (typeof e === "string" ? e : e.value) !== choice);
      const change: Partial<Field> = Array.isArray(field!.categories) ? { categories: remove(field!.categories) as Field["categories"] } : { constraints: { ...field!.constraints, enum: remove(field!.constraints?.enum ?? []) as string[] } };
      return make({ kind: "field", field: f.field! }, `no row's ${f.field} is ${show(choice)}`, f.details, [{ kind: "change-field", field: f.field!, change, label: `Remove ${show(choice)} from the choices`, changesSchema: true }]);
    }
    case "attachment.orphaned": {
      const path = `attachments/${String(f.details["file"])}`;
      return make({ kind: "file", path }, `no row holds ${path}`, f.details, [{ kind: "remove-file", path, label: "Delete the file", changesSchema: false }]);
    }
    default: {
      // A value that breaks its field's rule.
      const value = row?.[f.field!];
      const code = f.code as ValueProblem["code"];
      return make(
        { kind: "cell", row: f.row!, field: f.field! },
        `${f.field}: ${valueMessage(code, f.details as ValueProblem["details"], field!, value)}`,
        { ...f.details, field: f.field! },
        row ? valueFixes(f.code, field!, row, f.details) : [],
      );
    }
  }
}

/** The fixes for a value that breaks its field's rule: correcting the value first, then widening the rule. */
function valueFixes(code: ProblemCode, field: Field, row: Row, details: Problem["details"]): Fix[] {
  const at = { row: row.id, field: field.name };
  const value = row[field.name];
  const fixes: Fix[] = [];
  const set = (to: unknown, label: string) => fixes.push({ kind: "set-value", ...at, value: to, label, changesSchema: false });
  const clear = () => fixes.push({ kind: "clear-value", ...at, label: "Clear it", changesSchema: false });
  const widen = (constraints: Record<string, unknown>, label: string) =>
    fixes.push({ kind: "change-field", field: field.name, change: { constraints: { ...field.constraints, ...constraints } }, label, changesSchema: true });
  switch (code) {
    case "value.required":
      widen({ required: undefined }, `Don’t require ${field.name}`);
      break;
    case "value.type": {
      const converted = convert(field, value);
      if (converted !== undefined) set(converted, `Make it ${show(converted)}`);
      if (!field.constraints?.required) clear();
      break;
    }
    case "value.choice": {
      const allowed = new Set(enumValues(field));
      const items = Array.isArray(value) ? value : [value];
      const strays = items.filter((v) => !allowed.has(v as string)).map(String);
      if (Array.isArray(value)) set(value.filter((v) => allowed.has(v as string)), `Remove ${strays.map(show).join(", ")}`);
      else clear();
      const options = Array.isArray(field.categories) ? field.categories : (field.constraints?.enum ?? []);
      const added = [...options, ...strays];
      fixes.push({ kind: "change-field", field: field.name, change: Array.isArray(field.categories) ? { categories: added } : { constraints: { ...field.constraints, enum: added } }, label: `Add ${strays.map(show).join(", ")} as a choice`, changesSchema: true });
      break;
    }
    case "value.minimum":
    case "value.maximum": {
      const key = details["constraint"] as "minimum" | "maximum";
      set(details["limit"], `Make it ${details["limit"]}`);
      widen({ [key]: value }, `${key === "minimum" ? "Lower the minimum" : "Raise the maximum"} to ${value}`);
      break;
    }
    case "value.exclusive-minimum":
    case "value.exclusive-maximum": {
      const key = details["constraint"] as "exclusiveMinimum" | "exclusiveMaximum";
      const inclusive = key === "exclusiveMinimum" ? "minimum" : "maximum";
      widen({ [key]: undefined, [inclusive]: details["limit"] }, `Allow ${details["limit"]} itself`);
      break;
    }
    case "value.max-length":
      set(String(value).slice(0, Number(details["limit"])), `Cut it to ${details["limit"]} characters`);
      widen({ maxLength: details["length"] }, `Allow ${details["length"]} characters`);
      break;
    case "value.min-length":
      widen({ minLength: details["length"] }, `Allow ${details["length"]} characters`);
      break;
    case "value.pattern":
      widen({ pattern: undefined }, "Remove the pattern");
      break;
  }
  return fixes;
}

/** A value of the wrong type said as its field's, when there's one plain answer: "12" in a number field is 12. */
function convert(field: Field, value: unknown): unknown {
  if (typeof value === "string") {
    const t = value.trim();
    if ((field.type === "number" || field.type === "integer" || field.type === "year") && t !== "" && Number.isFinite(Number(t))) {
      const n = Number(t);
      return field.type === "number" || Number.isSafeInteger(n) ? n : undefined;
    }
    if (field.type === "boolean" && (t === "true" || t === "false")) return t === "true";
  }
  if (typeof value === "number" && Number.isFinite(value) && field.type === "string") return String(value);
  return undefined;
}

/** A reader's diagnostic as a problem: its code, its place, and the fixes for a kept line. */
function fromDiagnostic(d: ValidationError, table: string): Problem {
  const code = (d.code ?? "file.malformed") as ProblemCode;
  let at: ProblemPlace = { kind: "table" };
  const fixes: Fix[] = [];
  if (d.file !== undefined && d.text !== undefined) {
    at = { kind: "line", file: d.file, line: d.rowIndex, text: d.text };
    const line = { file: d.file, line: d.rowIndex };
    if (code === "line.id-repeated") {
      fixes.push({ kind: "choose-line", ...line, label: "Use this line instead", changesSchema: false });
      fixes.push({ kind: "keep-as-new-row", ...line, label: "Keep it as a new row", changesSchema: false });
    }
    if (code === "id.missing") fixes.push({ kind: "keep-as-new-row", ...line, label: "Keep it as a new row", changesSchema: false });
    if (code !== "line.repeat-left-out") fixes.push({ kind: "remove-line", ...line, label: code === "line.conflict-marker" ? "Remove the marker" : "Remove the line", changesSchema: false });
  } else if (d.rowId !== undefined && d.field !== undefined) {
    at = { kind: "cell", row: d.rowId, field: d.field };
    if (code === "cell.repeated") fixes.push({ kind: "remove-formula", row: d.rowId, field: d.field, repeats: true, label: "Keep only the first formula", changesSchema: false });
    if (code === "cell.typed-over") {
      fixes.push({ kind: "remove-formula", row: d.rowId, field: d.field, label: "Keep the value", changesSchema: false });
      fixes.push({ kind: "clear-value", row: d.rowId, field: d.field, label: "Use the formula", changesSchema: false });
    }
  } else if (d.field !== undefined) {
    at = { kind: "field", field: d.field };
    if (code === "field.id-repeated") fixes.push({ kind: "give-field-new-id", field: d.field, label: `Give ${d.field} its own id`, changesSchema: true });
  } else if (d.file !== undefined) {
    at = { kind: "file", path: d.file };
  }
  return {
    code,
    severity: severityOf(code),
    table,
    at,
    details: { ...(d.rowId !== undefined ? { row: d.rowId } : {}), ...(d.field !== undefined ? { field: d.field } : {}) },
    message: d.message,
    fixes,
  };
}
