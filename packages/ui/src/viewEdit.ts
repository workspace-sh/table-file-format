// The rules behind the view settings panel (#86 step 6), kept apart from
// React so they can be tested on their own: which operators a field can
// use, how a typed filter value becomes a stored one, and which field a
// layout starts from. Views are SPEC section 4.

import { enumOptions, type Field, type FieldType, type FilterOperator, type TableSchema, type View, type ViewFilter, type ViewLayout, type ViewSort } from "@workspace.sh/table-core";

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  ends_with: "ends with",
  empty: "is empty",
  not_empty: "is not empty",
  in: "is any of",
  not_in: "is none of",
};

const NUMERIC: FieldType[] = ["number", "integer", "year", "duration"];
const DATES: FieldType[] = ["date", "datetime", "time"];

/** The operators that mean something for this field. */
export function operatorsFor(field: Field | undefined): FilterOperator[] {
  const type = field?.type ?? "string";
  if (type === "boolean") return ["eq", "neq", "empty", "not_empty"];
  // A list (a multi-select, say) is asked about its items (D35).
  if (type === "array") return ["contains", "not_contains", "in", "not_in", "empty", "not_empty"];
  if (NUMERIC.includes(type) || DATES.includes(type)) {
    return ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty", "in", "not_in"];
  }
  if (field?.constraints?.enum) return ["eq", "neq", "in", "not_in", "empty", "not_empty"];
  return ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty", "in", "not_in"];
}

/** `empty` and `not_empty` stand alone; everything else compares with a value. */
export function takesValue(operator: FilterOperator): boolean {
  return operator !== "empty" && operator !== "not_empty";
}

function one(field: Field | undefined, raw: string): unknown {
  const text = raw.trim();
  const type = field?.type ?? "string";
  if (type === "boolean") return text.toLowerCase() === "true";
  if (NUMERIC.includes(type)) {
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? n : text;
  }
  return text;
}

/**
 * What a typed value is stored as: a number for a numeric field, a boolean
 * for a yes/no one, and for "is any of" / "is none of" a list, typed
 * comma-separated.
 */
export function filterValueFrom(field: Field | undefined, operator: FilterOperator, raw: string): unknown {
  if (!takesValue(operator)) return undefined;
  if (operator === "in" || operator === "not_in") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => one(field, part));
  }
  return one(field, raw);
}

/** A stored value as it's typed back in the box. */
export function filterValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return value === undefined || value === null ? "" : String(value);
}

/**
 * The field a layout is drawn from when it's chosen: a board's columns
 * (an enum, else any text field), a calendar's dates. Null when the table
 * has none, and the layout isn't offered.
 */
export function layoutFieldFor(layout: ViewLayout, schema: TableSchema): string | null {
  const live = schema.fields.filter((f) => !f.deprecated);
  if (layout === "board") {
    return (live.find((f) => f.constraints?.enum) ?? live.find((f) => f.type === "string"))?.name ?? null;
  }
  if (layout === "calendar") return live.find((f) => f.type === "date" || f.type === "datetime")?.name ?? null;
  return null;
}

export const LAYOUTS: ViewLayout[] = ["table", "board", "list", "gallery", "calendar"];

/** Whether the table has what this layout needs. */
export function canUseLayout(layout: ViewLayout, schema: TableSchema): boolean {
  if (layout === "board" || layout === "calendar") return layoutFieldFor(layout, schema) !== null;
  return true;
}

export const LAYOUT_LABELS: Record<ViewLayout, string> = {
  table: "Table",
  board: "Board",
  list: "List",
  gallery: "Gallery",
  calendar: "Calendar",
};

/** Every layout, each marked when the table can't use it and why. */
export function layoutOptions(schema: TableSchema): { value: ViewLayout; label: string; disabled: boolean }[] {
  return LAYOUTS.map((l) => {
    const usable = canUseLayout(l, schema);
    const why = usable ? "" : l === "calendar" ? " (needs a date field)" : " (needs a text field)";
    return { value: l, label: LAYOUT_LABELS[l] + why, disabled: !usable };
  });
}

/** Changing layout: a board or calendar starts from a field it can use when it has none yet. */
export function layoutPatch(view: View, schema: TableSchema, layout: ViewLayout): Partial<View> {
  const patch: Partial<View> = { layout };
  if (layout === "board" && !view.board_field) patch.board_field = layoutFieldFor("board", schema) ?? undefined;
  if (layout === "calendar" && !view.calendar_field) patch.calendar_field = layoutFieldFor("calendar", schema) ?? undefined;
  return patch;
}

/** The fields a view's pickers offer: none deprecated, and each picker only what it can use. */
export function viewFieldChoices(schema: TableSchema): { live: Field[]; board: Field[]; date: Field[]; group: Field[] } {
  const live = schema.fields.filter((f) => !f.deprecated);
  return {
    live,
    board: live.filter((f) => f.type === "string" && !f.relation),
    date: live.filter((f) => f.type === "date" || f.type === "datetime"),
    group: live.filter((f) => !f.computed),
  };
}

/** Filters set; none at all is no filter. */
export function filtersPatch(next: ViewFilter[]): Partial<View> {
  return { filter: next.length ? next : undefined };
}

/**
 * Sorts set. A sort replaces any order rows were dragged into: choosing
 * one says how rows should run, and a manual order would silently win
 * (SPEC section 4).
 */
export function sortsPatch(next: ViewSort[]): Partial<View> {
  return { sort: next.length ? next : undefined, order: undefined };
}

/** One sort moved from `from` to `to`, the rest keeping their order. */
export function moveSort(sorts: ViewSort[], from: number, to: number): ViewSort[] {
  if (from === to || from < 0 || from >= sorts.length || to < 0 || to >= sorts.length) return sorts;
  const next = sorts.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** The columns a view shows: its `fields`, or, absent, all of them. */
export function shownColumns(view: View, schema: TableSchema): Set<string> {
  return new Set(view.fields ?? schema.fields.map((f) => f.name));
}

/**
 * One column shown or hidden, in the schema's order. All shown is written
 * as no `fields` at all, so columns added later show too. Null when it
 * would hide the last column: one always shows.
 */
export function columnShownPatch(view: View, schema: TableSchema, name: string, on: boolean): Partial<View> | null {
  const shown = shownColumns(view, schema);
  const next = schema.fields.map((f) => f.name).filter((n) => (n === name ? on : shown.has(n)));
  if (next.length === 0) return null;
  return { fields: next.length === schema.fields.length ? undefined : next };
}

/** A new filter: on the first field, with its first operator. Null when there's no field. */
export function newFilter(live: Field[]): ViewFilter | null {
  const first = live[0];
  return first ? { field: first.name, operator: operatorsFor(first)[0]! } : null;
}

/** A new sort: ascending, on the first field not already sorted by. Null when every field is. */
export function newSort(live: Field[], sorts: ViewSort[]): ViewSort | null {
  const used = new Set(sorts.map((s) => s.field));
  const next = live.find((f) => !used.has(f.name));
  return next ? { field: next.name, direction: "asc" } : null;
}

/** A filter moved to another field: its operator kept if that field has it, its value dropped. */
export function filterOnField(filter: ViewFilter, field: Field | undefined): ViewFilter {
  const ops = operatorsFor(field);
  return { field: field?.name ?? filter.field, operator: ops.includes(filter.operator) ? filter.operator : ops[0]! };
}

/** A filter's operator changed: the value typed so far, `draft`, carried over when the operator takes one. */
export function filterWithOperator(filter: ViewFilter, field: Field | undefined, operator: FilterOperator, draft: string): ViewFilter {
  const value = takesValue(operator) ? filterValueFrom(field, operator, draft) : undefined;
  return { field: filter.field, operator, ...(value === undefined ? {} : { value }) };
}

/** Whether a filter's value is one of the field's choices, picked, rather than typed. */
export function picksChoice(field: Field | undefined, operator: FilterOperator): boolean {
  return enumOptions(field).length > 0 && ["eq", "neq", "contains", "not_contains"].includes(operator);
}

/** What a view settings panel takes, whatever draws it: the web one and table-gtk's. */
export interface ViewSettingsProps {
  view: View;
  schema: TableSchema;
  onChange: (patch: Partial<View>) => void;
  /** Absent when this is the table's only view: a table always has one. */
  onDelete?: () => void;
  onClose: () => void;
  /**
   * Closing by Cancel, where the platform offers it (a phone's settings
   * sheet): puts back everything changed since the settings opened. Done
   * (`onClose`) keeps it. Absent: no Cancel.
   */
  onCancel?: () => void;
  /** Filters, sorts and grouping, as this reader's own. Absent: they change the view for everyone. */
  onArrange?: (patch: Partial<View>) => void;
  /** This reader's filters, sorts or grouping differ from the view as saved. */
  personal?: boolean;
  onSaveForEveryone?: () => void;
  onReset?: () => void;
}

/** A table view made a Sheet view, or not (D41): off is no `coordinates` at all. */
export function sheetPatch(on: boolean): Partial<View> {
  return { coordinates: on || undefined };
}

/** Said under the sorts when rows are in a dragged order and no sort is set. */
export function orderNote(view: View, sorts: ViewSort[]): string | undefined {
  return view.order && view.order.length > 0 && sorts.length === 0 ? "Rows are in the order they were dragged into. Adding a sort replaces it." : undefined;
}
