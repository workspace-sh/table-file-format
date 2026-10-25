/**
 * CSV ⇄ `.table/` conversion. The **only** format-specific converter
 * that lives in core (SPEC section 11); Frictionless / CSVW / Grist
 * converters belong in optional sibling packages.
 *
 * Pure string ⇄ data — no filesystem, browser-safe, so it ships in the
 * barrel. RFC 4180 quoting on the way out. On the way in the text is read
 * by Papa Parse (quoted fields, embedded separators and newlines, escaped
 * `""`, a leading BOM; commas, tabs, semicolons or pipes, whichever the
 * file uses).
 *
 * Export is **lossy by definition**: relations serialise to their raw
 * id(s), attachments to their filename, and long-form bodies aren't
 * represented at all. Call `csvExportWarnings()` to surface what a
 * given table would lose before exporting.
 */
import { withFieldIds } from "./fieldIds.js";
import type { Field, ParsedTable, Row, TableSchema } from "./types.js";
import Papa from "papaparse";
import { newId } from "./id.js";
import { columnLetter } from "./formula.js";

export interface FromCSVResult {
  rows: Row[];
  schema: TableSchema;
}

export interface ToCSVOptions {
  /** Restrict/ order exported columns by field name. Default: all schema fields. */
  fields?: string[];
}

// ---- Export ----

/**
 * Human-readable warnings about what `toCSV` will drop for this table —
 * relation ids flattened, attachment filenames only, bodies omitted.
 * Empty array means a clean (lossless-enough) export. Surface these in
 * a UI before writing a CSV so "lossy" isn't silent (SPEC section 11).
 */
export function csvExportWarnings(
  table: Pick<ParsedTable, "schema" | "rows" | "bodies">,
): string[] {
  const warnings: string[] = [];
  for (const f of table.schema.fields) {
    if (f.relation) {
      const many = f.relation.cardinality === "many";
      warnings.push(
        `field "${f.name}" is a relation → exported as raw id${many ? "s (joined)" : ""}, not resolved`,
      );
    }
    if (f.attachment) {
      warnings.push(`field "${f.name}" is an attachment → exported as filename only`);
    }
  }
  const bodyCount = table.bodies ? Object.keys(table.bodies).length : 0;
  if (bodyCount > 0) {
    warnings.push(`${bodyCount} row${bodyCount === 1 ? "" : "s"} have markdown bodies → not included in CSV`);
  }
  return warnings;
}

export function toCSV(
  table: Pick<ParsedTable, "schema" | "rows">,
  options?: ToCSVOptions,
): string {
  const names = options?.fields ?? table.schema.fields.map((f) => f.name);
  // `id` is system-level and never declared in schema, but it's the
  // row identity — include it first so the CSV round-trips back to the
  // same rows rather than minting fresh ids on re-import.
  const header = ["id", ...names];
  const lines = [header.map(csvCell).join(",")];
  for (const row of table.rows) {
    const cells = header.map((name) => csvCell(serialiseValue(row[name])));
    lines.push(cells.join(","));
  }
  // RFC 4180 uses CRLF, but LF round-trips everywhere and matches the
  // rest of the format's POSIX-newline convention.
  return lines.join("\n") + "\n";
}

function serialiseValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // arrays (incl. multi-relation id lists) and objects → JSON
  return JSON.stringify(value);
}

/** RFC 4180 field quoting: wrap in quotes and double internal quotes when needed. */
function csvCell(s: string): string {
  if (s === "") return "";
  if (/[",\n\r]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---- Import ----

export function fromCSV(csv: string, schema?: TableSchema): FromCSVResult {
  const table = delimitedCells(csv);
  if (table.length === 0) {
    return { rows: [], schema: schema ?? { fields: [] } };
  }
  const header = table[0]!;
  const dataRows = table.slice(1);
  const idIndex = header.indexOf("id");
  const dataColumns = header
    .map((name, i) => ({ name, i }))
    .filter((c) => c.name !== "id");

  const resolvedSchema =
    schema ?? inferSchema(dataColumns, dataRows);
  const fieldByName = new Map(resolvedSchema.fields.map((f) => [f.name, f]));

  const rows: Row[] = dataRows.map((cells) => {
    const rawId = idIndex >= 0 ? cells[idIndex]?.trim() : undefined;
    const row: Row = { id: rawId && rawId.length > 0 ? rawId : newId() };
    for (const { name, i } of dataColumns) {
      const cell = cells[i];
      if (cell === undefined || cell === "") continue; // empty → omit key
      row[name] = coerce(cell, fieldByName.get(name));
    }
    return row;
  });

  return { rows, schema: resolvedSchema };
}

/**
 * Coerce a raw CSV cell (always a string) to a typed value. With a
 * declared field the type drives coercion; without one (unknown
 * column) the value stays a string.
 */
function coerce(cell: string, field: Field | undefined): unknown {
  if (!field) return cell;
  switch (field.type) {
    case "number":
    case "integer":
    case "year": {
      const n = Number(cell);
      return Number.isFinite(n) ? n : cell;
    }
    case "any": {
      // Each cell as what it is (D56): a plain number a number, anything else its text.
      const t = cell.trim();
      return PLAIN_NUMBER.test(t) ? Number(t) : cell;
    }
    case "boolean": {
      const t = cell.trim().toLowerCase();
      if (t === "true" || t === "1") return true;
      if (t === "false" || t === "0") return false;
      return cell;
    }
    case "array":
    case "object": {
      try {
        return JSON.parse(cell);
      } catch {
        return cell;
      }
    }
    default:
      return cell;
  }
}

/**
 * Infer a schema from the data when none is supplied. Per column: all
 * non-empty cells numeric → integer/number; all boolean-ish → boolean;
 * otherwise string. Conservative — ambiguous columns stay string.
 */
function inferSchema(
  columns: { name: string; i: number }[],
  dataRows: string[][],
): TableSchema {
  const fields: Field[] = columns.map(({ name, i }) => {
    const values = dataRows
      .map((r) => r[i])
      .filter((v): v is string => v !== undefined && v !== "");
    return { name, type: inferType(values) };
  });
  return { fields };
}

function inferType(values: string[]): Field["type"] {
  if (values.length === 0) return "string";
  const allBool = values.every((v) => /^(true|false)$/i.test(v.trim()));
  if (allBool) return "boolean";
  const allNum = values.every((v) => v.trim() !== "" && Number.isFinite(Number(v)));
  if (allNum) {
    return values.every((v) => Number.isInteger(Number(v))) ? "integer" : "number";
  }
  return "string";
}

/**
 * Whether a sheet's first line looks like data, not headings (D59): every
 * column whose cells below are all numbers, dates or yes/no has one of
 * those in its first line too, and there's at least one such column. A
 * heading is words: "qty" over numbers says the line is a header.
 */
export function firstLineIsData(csv: string): boolean {
  const lines = delimitedCells(csv);
  if (lines.length < 2) return false;
  const [first, ...rest] = lines as [string[], ...string[][]];
  let typed = 0;
  for (let i = 0; i < first.length; i++) {
    const below = rest.map((cells) => (cells[i] ?? "").trim()).filter((v) => v !== "");
    const kind = below.length > 0 && below.every((v) => ISO_DATE.test(v) || ISO_DATETIME.test(v)) ? "date" : inferType(below);
    if (kind === "string") continue;
    typed++;
    const head = (first[i] ?? "").trim();
    const fits = kind === "date" ? ISO_DATE.test(head) || ISO_DATETIME.test(head) : kind === "boolean" ? /^(true|false)$/i.test(head) : head !== "" && Number.isFinite(Number(head));
    if (!fits) return false;
  }
  return typed > 0;
}

// -- A spreadsheet someone already has, opened as a table ----

/**
 * A delimited text file's cells, line by line, read by Papa Parse (the
 * parser most JavaScript reads CSV with): commas, tabs, semicolons (Excel
 * where the comma is the decimal mark) or pipes, whichever the file uses,
 * with quoted cells, line ends of either kind and a leading byte-order
 * mark handled. Lines with nothing in them are left out.
 */
export function delimitedCells(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, {
    delimitersToGuess: [",", "\t", ";", "|"],
    skipEmptyLines: "greedy",
  });
  return parsed.data;
}

export interface TableFromCSVOptions {
  /**
   * A field's stored key for a column's heading, unlike any in `taken`.
   * The heading itself, numbered when it repeats, when not given; an app
   * gives the rule its own new fields follow (a plain key keeps formulas
   * plain).
   */
  keyOf?: (heading: string, taken: ReadonlySet<string>) => string;
  /**
   * False: the first line is a row like the others, and the fields are
   * named for their columns, `A`, `B`, `C`… (D59). True when not given.
   */
  header?: boolean;
}

export interface TableFromCSV {
  schema: TableSchema;
  rows: Row[];
  /** Cells left out because their row had more of them than the file has headings. */
  extraCells: number;
}

/** A number as a spreadsheet writes one that is a quantity: no leading zeros or plus, and few enough digits to keep exactly. */
const PLAIN_NUMBER = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * A spreadsheet as a table (CSV, TSV, or any text `delimitedCells` reads): its first line is the headings, each a field
 * (the heading kept as the field's title, a key made for its name), and
 * every other line a row. What a column holds decides its type, as
 * `fromCSV` infers it, and a column of ISO dates is dates. Nothing is
 * guessed past that: `03/04/2025` and `£1,200` stay the text they are,
 * for whoever knows what they mean to set.
 *
 * A column headed `id` gives the rows their ids when every row has its
 * own; otherwise it is a column like any other and the rows get new ids.
 * A heading left empty is "Column N". Lines with nothing in them are no
 * rows.
 */
export function tableFromCSV(csv: string, options: TableFromCSVOptions = {}): TableFromCSV {
  const lines = delimitedCells(csv);
  if (lines.length === 0) return { schema: { fields: [] }, rows: [], extraCells: 0 };
  // Without a header row (D59): every line is a row, and each column is called by its letter.
  const header = options.header !== false;
  const widest = header ? 0 : Math.max(...lines.map((cells) => cells.length));
  const headings = header ? lines[0]!.map((cell) => cell.trim()) : Array.from({ length: widest }, (_, i) => columnLetter(i));
  const data = header ? lines.slice(1) : lines;
  const column = (i: number) => data.map((cells) => cells[i] ?? "").filter((cell) => cell !== "");

  // The rows' own ids, when a column gives every row a different one.
  const idAt = headings.indexOf("id");
  const ids = idAt >= 0 ? data.map((cells) => (cells[idAt] ?? "").trim()) : [];
  const ownIds = idAt >= 0 && ids.every((id) => id !== "") && new Set(ids).size === ids.length;

  const numbered = (heading: string, taken: ReadonlySet<string>) => {
    if (!taken.has(heading)) return heading;
    let n = 2;
    while (taken.has(`${heading} ${n}`)) n++;
    return `${heading} ${n}`;
  };
  const keyOf = options.keyOf ?? numbered;
  // `id` is each row's own, never a field's key.
  const taken = new Set<string>(["id"]);
  const columns: { at: number; field: Field }[] = [];
  headings.forEach((heading, at) => {
    if (ownIds && at === idAt) return;
    const title = heading === "" ? `Column ${at + 1}` : heading;
    const name = keyOf(title, taken);
    taken.add(name);
    const values = column(at);
    const guessed = inferType(values);
    // Mostly plain numbers, with some words among them ("n/a", "TBC"): each kept as what it is (D56).
    const numbers = values.filter((v) => PLAIN_NUMBER.test(v.trim())).length;
    const mixed = guessed === "string" && numbers > 0 && numbers * 2 >= values.length && numbers < values.length;
    const type: Field["type"] = mixed
      ? "any"
      : values.length > 0 && values.every((v) => ISO_DATE.test(v.trim()))
        ? "date"
        : values.length > 0 && values.every((v) => ISO_DATETIME.test(v.trim()))
          ? "datetime"
          : // Digits that aren't an amount (a phone number, a postcode, an account number) stay as written.
            (guessed === "integer" || guessed === "number") && !values.every((v) => PLAIN_NUMBER.test(v.trim()))
            ? "string"
            : guessed;
    columns.push({ at, field: { name, ...(title !== name ? { title } : {}), type } });
  });

  let extraCells = 0;
  const rows: Row[] = data.map((cells, r) => {
    extraCells += cells.slice(headings.length).filter((cell) => cell !== "").length;
    const row: Row = { id: ownIds ? ids[r]! : newId() };
    for (const { at, field } of columns) {
      const cell = cells[at];
      if (cell === undefined || cell === "") continue;
      row[field.name] = field.type === "date" || field.type === "datetime" ? cell.trim() : coerce(cell, field);
    }
    return row;
  });
  // Each field with its id (D62), from its name: a sheet read twice reads the same.
  return { schema: withFieldIds({ fields: columns.map((c) => c.field) }), rows, extraCells };
}

