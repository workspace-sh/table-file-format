// Rows an edit took out of the view on screen (#598): ticking Read in a
// "To read" view, choosing a stage a filter leaves out. The row goes at
// once, as before; this keeps what's needed for a light toast that says
// so, counts on while more go ("3 books left To read"), and puts them all
// back as one step.
//
// Only a discrete edit counts (a checkbox, a single choice, a multiple
// choice): a typed value is seen as it's typed, and a new row isn't one
// that left. Rows of a table held in the index aren't here (their edits go
// through the index, which says what the view holds), so those don't count
// yet.

import { applyView, enumOptions, type Field, type ParsedTable, type Row, type View } from "@workspace.sh/table-core";
import { rowTitleFor } from "./edits.ts";

/** Rows a discrete edit took out of the view on screen, since the toast saying so appeared. */
export interface Departed {
  /** The table, and its view on screen, they left. */
  key: string;
  viewId: string;
  /** Each row that left, in the order it left, with its value before the first edit counted (a row's first wins). */
  rows: { rowId: string; field: string; was: unknown }[];
  /** One more each time a row is counted: the toast starts its time again, and its count moves. */
  n: number;
}

/** A field whose edits are a choice made at once: a checkbox, a single choice, a multiple choice. */
export function isDiscreteField(field: Field | undefined): boolean {
  return !!field && (field.type === "boolean" || enumOptions(field).length > 0);
}

/** Whether a row is in a view: passes its filter (a sort or an order doesn't take a row out). */
function inView(table: ParsedTable, view: View, row: Row): boolean {
  if (!view.filter) return true;
  return applyView({ ...table, rows: [row] }, { ...view, sort: undefined, order: undefined }).length > 0;
}

/**
 * After an edit to a cell of the table on screen: the toast's rows with
 * this one added if the edit took it out of the view, as they were if it
 * didn't, or none if the edit wasn't discrete (a typed value starts over).
 */
export function afterCellEdit(
  departed: Departed | null,
  before: ParsedTable,
  after: ParsedTable,
  key: string,
  view: View | undefined,
  rowId: string,
  field: string,
): Departed | null {
  if (!isDiscreteField(after.schema.fields.find((f) => f.name === field))) return null;
  // Another view's toast is over.
  const kept = departed && departed.key === key && departed.viewId === view?.id ? departed : null;
  if (!view || before.indexed) return kept;
  const was = before.rows.find((r) => r.id === rowId);
  const now = after.rows.find((r) => r.id === rowId);
  if (!was || !now || !inView(before, view, was) || inView(after, view, now)) return kept;
  const rows = kept?.rows ?? [];
  const counted = rows.some((r) => r.rowId === rowId && r.field === field);
  return {
    key,
    viewId: view.id,
    rows: counted ? rows : [...rows, { rowId, field, was: was[field] }],
    n: (kept?.n ?? 0) + 1,
  };
}

/** How many different rows have left. */
export function departedCount(departed: Departed): number {
  return new Set(departed.rows.map((r) => r.rowId)).size;
}

/** What the toast says: "“Wild Rivers” left To read", or "3 books left To read" (the count first, to move as it counts). */
export interface DepartedText {
  /** The part that changes as rows are counted: the row's title in quotes, or the count. */
  lead: string;
  /** The rest: " left To read", " books left To read". */
  rest: string;
  /** All of it, to be read out (role="status"). */
  label: string;
}

/**
 * The toast's words. A row is named by its title; more are counted, called
 * by the table's own name lowercased ("books"), or "rows" when it has none.
 */
export function departedText(departed: Departed, table: ParsedTable, viewName: string): DepartedText {
  const count = departedCount(departed);
  const lead = count === 1 ? `“${rowTitleFor(table, departed.rows[0]!.rowId)}”` : count.toLocaleString();
  const noun = table.meta?.title?.trim().toLocaleLowerCase() || "rows";
  const rest = count === 1 ? ` left ${viewName}` : ` ${noun} left ${viewName}`;
  return { lead, rest, label: `${lead}${rest}` };
}
