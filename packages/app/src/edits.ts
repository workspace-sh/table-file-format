// Edits to a table, as an app makes them from its views: each takes a
// table and returns the table after the edit, never changing the one it
// was given. The web and Linux demos both apply these, so an edit means
// the same thing, and bumps the schema version the same way, everywhere.

import type { Field, ParsedTable, Row, TableSchema, View } from "@workspace.sh/table-core";
import { isSheet } from "@workspace.sh/table-core";
import { insertRowAt, sheetDependents } from "@workspace.sh/table-ui/shared";

import { bundleOf, bundleTables, tableNameOf } from "./bundles.ts";
import { CANCEL, type Confirm } from "./confirm.ts";

/** Apply `edit` to the table at `key` in an app's `bundle/table` map. */
export function onTable(
  tables: Record<string, ParsedTable>,
  key: string,
  edit: (table: ParsedTable) => ParsedTable,
): Record<string, ParsedTable> {
  const table = tables[key];
  if (!table) return tables;
  const next = edit(table);
  return next === table ? tables : { ...tables, [key]: next };
}

/** One more schema version: a structural change (SPEC section 2). Advisory outside single-writer use (D22). */
export function bumpSchemaVersion(schema: TableSchema): TableSchema {
  const current = (schema["schema-version"] as number | undefined) ?? 1;
  return { ...schema, "schema-version": current + 1 };
}

export function withCell(table: ParsedTable, rowId: string, field: string, value: unknown): ParsedTable {
  return { ...table, rows: table.rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)) };
}

/** A row's long-form body; empty removes it. */
export function withBody(table: ParsedTable, rowId: string, content: string): ParsedTable {
  const bodies = { ...(table.bodies ?? {}) };
  if (content.length === 0) delete bodies[rowId];
  else bodies[rowId] = content;
  return { ...table, bodies };
}

/**
 * A new row is just an id (D23), at the end of the file. The view it
 * lands in decides where it shows; a filter may hide it until its cells
 * are filled in.
 */
export function withRow(table: ParsedTable, id: string): ParsedTable {
  return { ...table, rows: [...table.rows, { id }] };
}

/**
 * A row at a place in a Sheet view (D41), where file order means
 * something: on the line above or below `anchor`, or into the view's
 * manual order. Unchanged when the view decides order another way.
 */
export function withRowAt(table: ParsedTable, viewId: string, anchor: string, where: "above" | "below", id: string): ParsedTable {
  const view = table.views.find((v) => v.id === viewId) ?? table.views[0];
  if (!view) return table;
  const placed = insertRowAt(table.rows, view, anchor, where, { id });
  if (!placed) return table;
  const views = placed.order ? table.views.map((v) => (v.id === view.id ? { ...v, order: placed.order } : v)) : table.views;
  return { ...table, rows: placed.rows, views };
}

/** Without the row, and its body. */
export function withoutRow(table: ParsedTable, rowId: string): ParsedTable {
  if (!table.bodies) return { ...table, rows: table.rows.filter((r) => r.id !== rowId) };
  const bodies = { ...table.bodies };
  delete bodies[rowId];
  return { ...table, rows: table.rows.filter((r) => r.id !== rowId), bodies };
}

/**
 * A field changed. A title or description is cosmetic; constraints,
 * deprecation, a relation or a formula change what the column means, so
 * they bump the schema version.
 */
export function withFieldPatch(table: ParsedTable, name: string, patch: Partial<Field>): ParsedTable {
  const fields = table.schema.fields.map((f) => (f.name === name ? { ...f, ...patch } : f));
  const structural = "constraints" in patch || "deprecated" in patch || "relation" in patch || "computed" in patch;
  const schema = { ...table.schema, fields };
  return { ...table, schema: structural ? bumpSchemaVersion(schema) : schema };
}

/** A new choice for a field. Unchanged when it already has it. */
export function withChoice(table: ParsedTable, name: string, value: string): ParsedTable {
  const field = table.schema.fields.find((f) => f.name === name);
  const existing = field?.constraints?.enum ?? [];
  if (!field || existing.some((o) => (typeof o === "string" ? o : o.value) === value)) return table;
  const fields = table.schema.fields.map((f) =>
    f.name === name ? { ...f, constraints: { ...(f.constraints ?? {}), enum: [...existing, value] } } : f,
  );
  return { ...table, schema: bumpSchemaVersion({ ...table.schema, fields }) };
}

/** A field one place earlier or later. Unchanged at either end. */
export function withFieldMoved(table: ParsedTable, name: string, delta: -1 | 1): ParsedTable {
  const from = table.schema.fields.findIndex((f) => f.name === name);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= table.schema.fields.length) return table;
  const fields = table.schema.fields.slice();
  const [moved] = fields.splice(from, 1);
  fields.splice(to, 0, moved!);
  return { ...table, schema: bumpSchemaVersion({ ...table.schema, fields }) };
}

/**
 * A new field, at the end. A view that lists its fields shows only those,
 * so the field joins the view it was added from (`fromView`), or it would
 * never appear where it was added; other views are left as they are.
 */
export function withField(table: ParsedTable, field: Field, fromView?: string): ParsedTable {
  if (table.schema.fields.some((f) => f.name === field.name)) return table;
  const views = table.views.map((v) =>
    v.id === fromView && Array.isArray(v.fields) && !v.fields.includes(field.name) ? { ...v, fields: [...v.fields, field.name] } : v,
  );
  return { ...table, schema: bumpSchemaVersion({ ...table.schema, fields: [...table.schema.fields, field] }), views };
}

export function withViewPatch(table: ParsedTable, viewId: string, patch: Partial<View>): ParsedTable {
  return { ...table, views: table.views.map((v) => (v.id === viewId ? { ...v, ...patch } : v)) };
}

export function withView(table: ParsedTable, view: View): ParsedTable {
  return { ...table, views: [...table.views, view] };
}

/** Without the view. A table keeps at least one: the last is never removed. */
export function withoutView(table: ParsedTable, viewId: string): ParsedTable {
  if (table.views.length <= 1) return table;
  return { ...table, views: table.views.filter((v) => v.id !== viewId) };
}

/** A row as a person would name it: its first text field, else its id. For confirmations. */
export function rowTitleFor(table: ParsedTable, rowId: string): string {
  const row: Row | undefined = table.rows.find((r) => r.id === rowId);
  if (!row) return rowId;
  for (const field of table.schema.fields) {
    if (field.type === "string") {
      const v = row[field.name];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return rowId;
}

/**
 * What to ask before changing a view's settings, or null when nothing is
 * lost and the change can simply be made. Turning a Sheet view into
 * anything else loses its grid, so formulas that read it by place will
 * show #REF! (D41); the answer to go ahead is `stop`.
 */
export function viewPatchPrompt(
  tables: Record<string, ParsedTable>,
  key: string,
  view: View,
  patch: Partial<View>,
): Confirm | null {
  if (!isSheet(view) || isSheet({ ...view, ...patch })) return null;
  const readers = sheetDependents(bundleTables(tables, bundleOf(key)), tableNameOf(key), view.id).length;
  if (readers === 0) return null;
  return {
    heading: `${readers === 1 ? "A formula reads" : `${readers} formulas read`} this sheet by place and will show #REF!.`,
    body: "Stop showing it as a sheet?",
    responses: [CANCEL, { id: "stop", label: "Stop", destructive: true }],
  };
}

/**
 * What to ask before deleting a view: the rows stay, only this way of
 * showing them goes; and, for a Sheet view, how many formulas read it by
 * place and will show #REF! (D41). Null when it's the table's last view,
 * which can't be deleted.
 */
export function deleteViewPrompt(tables: Record<string, ParsedTable>, key: string, view: View): Confirm | null {
  const table = tables[key];
  if (!table || table.views.length <= 1) return null;
  const readers = isSheet(view) ? sheetDependents(bundleTables(tables, bundleOf(key)), tableNameOf(key), view.id).length : 0;
  const losing = readers > 0 ? ` ${readers === 1 ? "A formula reads" : `${readers} formulas read`} it by place and will show #REF!.` : "";
  return {
    heading: `Delete the view “${view.name}”?`,
    body: `The rows stay; only this way of showing them goes.${losing}`,
    responses: [CANCEL, { id: "delete", label: "Delete", destructive: true }],
  };
}

/**
 * Deleting a view: what to ask, and which view shows after (the table's
 * first other view). Null when it's the table's last view, which can't be
 * deleted.
 */
export function deletingView(
  tables: Record<string, ParsedTable>,
  key: string,
  view: View,
): { prompt: Confirm; nextViewId: string } | null {
  const prompt = deleteViewPrompt(tables, key, view);
  const next = tables[key]?.views.find((v) => v.id !== view.id);
  return prompt && next ? { prompt, nextViewId: next.id } : null;
}

/**
 * Deleting a row: what to ask (its document goes with it), and whether the
 * document open now is that row's, so the app closes it once the row goes.
 */
export function deletingRow(table: ParsedTable, rowId: string, openBody: string | null): { prompt: Confirm; closeBody: boolean } {
  const hasBody = table.bodies?.[rowId] !== undefined;
  return {
    prompt: {
      heading: `Delete “${rowTitleFor(table, rowId)}”?`,
      body: hasBody ? "The row and its document are removed from the file." : "The row is removed from the file.",
      responses: [CANCEL, { id: "delete", label: "Delete", destructive: true }],
    },
    closeBody: openBody === rowId,
  };
}
