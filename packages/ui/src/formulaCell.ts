// A formula cell, opened to see how it was worked out: what the column's
// one formula is, what it read in this row and in others, what a changed
// formula would make here, and what saving stores (D29, D34, D41). The
// web views and table-gtk both show this, from here.

import {
  compileFormula,
  computeRows,
  coordinateOf,
  formulaRefs,
  formulaType,
  parseExpr,
  printFormula,
  type CompileResult,
  type ComputeOptions,
  type Field,
  type FieldType,
  type FormulaRef,
  type Grid,
  type Row,
  type View,
} from "@workspace.sh/table-core";

import { placeCells } from "./sheets";

/** The formula dialect stored in `computed.dialect` (D29). */
export const FORMULA_DIALECT = "table-expr-v1";

/** Integers and numbers are one family: a formula switching between them doesn't change the field's type. */
export function typeFamily(t: FieldType): string {
  return t === "integer" || t === "number" ? "number" : t;
}

/** The formula as it's first shown for editing: in the reader's syntax, against the sheet's grid. */
export function formulaDraftOf(field: Field, grid: Grid | undefined, syntax?: "excel" | "stored"): string {
  return printFormula(field.computed?.expr ?? "", { grid, syntax });
}

/**
 * The line under a formula box: why it can't be saved, what might go
 * wrong, or, once it compiles, exactly what the file will hold. The stored
 * form is shown only when it differs from what was typed.
 */
export type FormulaStatus =
  | { kind: "error"; message: string }
  | { kind: "ok"; warnings: string[]; storedAs?: string };

export function formulaStatus(result: CompileResult, typed: string): FormulaStatus {
  if (!result.ok) return { kind: "error", message: result.message };
  return { kind: "ok", warnings: result.warnings, ...(typed.trim() === result.stored ? {} : { storedAs: result.stored }) };
}

/** One value a formula read: which field, what to call it, and its value. */
export interface FormulaInput {
  field: string;
  label: string;
  value: unknown;
  /** Another row's, by id; absent for this row. */
  rowId?: string;
}

export interface FormulaExplained {
  /** What the draft compiles to; null when the panel is read-only. */
  compiled: CompileResult | null;
  status: FormulaStatus | null;
  /** The draft compiles to a formula other than the stored one. */
  changed: boolean;
  /** What it read in this row, then in others. */
  thisRow: FormulaInput[];
  otherRows: FormulaInput[];
  /** What this row would show with the draft, when it changed. */
  preview?: { value: unknown };
  /** What saving stores, when it can be saved: the formula, and a new type if its family changed. */
  save?: Partial<Field>;
}

/**
 * Explain the formula in `field` for `row` (as displayed, computed values
 * filled in), with `draft` typed in the box. `editable` false: read-only,
 * nothing compiles. `allRows` is every row as stored, so another row's
 * input reads as its cell does.
 */
export function explainFormula(options: {
  field: Field;
  row: Record<string, unknown>;
  fields: Field[];
  draft: string;
  editable: boolean;
  grid?: Grid;
  allRows?: Row[];
  computeOptions?: ComputeOptions;
}): FormulaExplained {
  const { field, row, fields, draft, editable, grid, computeOptions } = options;
  const stored = field.computed?.expr ?? "";
  const compiled = editable ? compileFormula(draft, { fields: fields.map((f) => f.name), grid }) : null;
  const changed = compiled?.ok === true && compiled.stored !== stored;
  const shownExpr = changed && compiled?.ok ? compiled.expr : null;
  const parsed = parseExpr(stored);
  const refs = shownExpr ? formulaRefs(shownExpr) : parsed.ok ? formulaRefs(parsed.expr) : [];
  const title = (name: string) => fields.find((f) => f.name === name)?.title ?? name;
  const rowId = String(row.id);
  const tableRows = options.allRows ?? [row as Row];
  const computedAll = computeRows({ fields }, tableRows, computeOptions).rows;
  const valueIn = (id: string, name: string) => (id === rowId ? row[name] : computedAll.find((r) => r.id === id)?.[name]);

  const thisRow = refs
    .filter((r) => r.rowId === undefined || r.rowId === rowId)
    .map((r) => ({ field: r.field, label: title(r.field), value: row[r.field] }));
  const otherRows = refs
    .filter((r) => r.rowId !== undefined && r.rowId !== rowId)
    .map((r) => ({
      field: r.field,
      rowId: r.rowId!,
      label: (grid && coordinateOf(r.field, r.rowId!, grid)) ?? `${title(r.field)} of row ${r.rowId}`,
      value: valueIn(r.rowId!, r.field),
    }));

  let preview: { value: unknown } | undefined;
  let save: Partial<Field> | undefined;
  if (changed && compiled?.ok) {
    const trial = fields.map((f) => (f.name === field.name ? { ...f, computed: { expr: compiled.stored, dialect: FORMULA_DIALECT } } : f));
    preview = { value: computeRows({ fields: trial }, tableRows, computeOptions).rows.find((r) => r.id === rowId)?.[field.name] };
    const produced = formulaType(compiled.expr, new Map(fields.map((f) => [f.name, f.type] as const)));
    save = {
      computed: { expr: compiled.stored, dialect: FORMULA_DIALECT },
      ...(typeFamily(produced) !== typeFamily(field.type) ? { type: produced } : {}),
    };
  }

  return {
    compiled,
    status: compiled ? formulaStatus(compiled, draft) : null,
    changed,
    thisRow,
    otherRows,
    ...(preview ? { preview } : {}),
    ...(save ? { save } : {}),
  };
}

/**
 * The cells an open formula reads, to outline while it's open: by row id,
 * this row, or by place in a Sheet view's saved grid (D41). Keys are
 * `rowId + "\u0000" + field`.
 */
export function formulaInputCells(
  field: Field | undefined,
  rowId: string,
  view: View,
  columns: string[],
  sheetOrder: string[] | undefined,
): Set<string> {
  const out = new Set<string>();
  const expr = field?.computed?.expr;
  if (!expr) return out;
  const parsed = parseExpr(expr);
  const refs: FormulaRef[] = parsed.ok ? formulaRefs(parsed.expr) : [];
  for (const r of refs) {
    if (r.place) {
      if (sheetOrder) for (const c of placeCells(r, view.id, rowId, sheetOrder, columns)) out.add(`${c.rowId}\u0000${c.field}`);
    } else out.add(`${r.rowId ?? rowId}\u0000${r.field}`);
  }
  return out;
}

/**
 * The grid a table view types and shows formulas against (D41): a Sheet
 * view's saved grid when there is one, else the rows as shown. Undefined
 * for a view without coordinates.
 */
export function viewGrid(
  view: View,
  columns: string[],
  shownRowIds: string[],
  sheet?: { order: string[]; sheets: Grid["sheets"] },
): Grid | undefined {
  if (view.coordinates !== true) return undefined;
  return sheet ? { columns, rows: sheet.order, sheet: view.id, sheets: sheet.sheets } : { columns, rows: shownRowIds };
}

/** An example formula for an empty formula entry, in the syntax the reader types. */
export function formulaPlaceholder(syntax: "excel" | "stored" | undefined): string {
  return syntax === "stored" ? "(round (/ budget 12) 0)" : "=round(budget / 12, 0)";
}

/**
 * Whether a formula, typed up to the cursor, is waiting for something to
 * work on (after `=`, an operator, `(` or `,`): a tap or click on a cell
 * then adds a reference to it, as a spreadsheet's formula bar does, rather
 * than selecting the cell.
 */
export function expectsReference(beforeCursor: string): boolean {
  return /[-+*/(=,&<>^]\s*$/.test(beforeCursor);
}
