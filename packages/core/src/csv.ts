/**
 * CSV ⇄ `.table/` conversion. The **only** format-specific converter
 * that lives in core (SPEC section 11); Frictionless / CSVW / Grist
 * converters belong in optional sibling packages.
 *
 * Pure string ⇄ data — no filesystem, browser-safe, so it ships in the
 * barrel. RFC 4180 quoting on the way out; a tolerant RFC 4180 parser
 * on the way in (quoted fields, embedded commas / newlines / escaped
 * `""`, optional BOM).
 *
 * Export is **lossy by definition**: relations serialise to their raw
 * id(s), attachments to their filename, and long-form bodies aren't
 * represented at all. Call `csvExportWarnings()` to surface what a
 * given table would lose before exporting.
 */
import type { Field, ParsedTable, Row, TableSchema } from "./types";
import { newId } from "./id";

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
      // `cardinality` lands with the schema-vocabulary work; read it
      // forward-compatibly so this converter doesn't depend on that PR.
      const many =
        (f.relation as { cardinality?: string }).cardinality === "many";
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
  const table = parseCSV(csv);
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
 * RFC 4180 parser → array of rows, each an array of string cells.
 * Handles quoted fields, embedded commas / newlines, escaped `""`, a
 * leading BOM, and both LF and CRLF line endings. A trailing newline
 * does not produce a spurious empty final row.
 */
function parseCSV(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      pushField();
      i++;
    } else if (ch === "\n") {
      pushRow();
      i++;
    } else if (ch === "\r") {
      // swallow CRLF (and a bare CR) as one line break
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  // Flush a final field/row unless the input ended exactly on a newline
  // (no dangling content) — avoids a spurious empty trailing row.
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  return rows;
}
