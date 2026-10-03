// What every renderer of a view shows, whatever draws it: the web and
// native views here, and table-gtk on Linux. No platform code.

import {
  applyGroup,
  effectiveFormat,
  enumOptions,
  formatAddress,
  formatValue as formatWithFieldFormat,
  FormulaError,
  stringFormatKind,
  viewTotal,
  type DisplayOptions,
  type Field,
  type ParsedTable,
  type Row,
  type TableSchema,
  type View,
  type ViewTotal,
} from "@workspace.sh/table-core";

/**
 * Body row height when the view doesn't set one: one line of text plus
 * the cell's vertical padding. Every body row has the view's height, in
 * both panes, so the frozen title column can't drift out of line.
 */
export const DEFAULT_ROW_HEIGHT = 44;
export const MIN_ROW_HEIGHT = 36;
export const MAX_ROW_HEIGHT = 240;
export const CELL_LINE_HEIGHT = 20;
export const CELL_PADDING_BLOCK = 10;
/** Lines of text a row of this height shows. */
export function linesFor(rowHeight: number): number {
  return Math.max(1, Math.floor((rowHeight - 2 * CELL_PADDING_BLOCK) / CELL_LINE_HEIGHT));
}

export function fieldsByName(schema: TableSchema): Map<string, Field> {
  return new Map(
    schema.fields.map((f) => {
      const format = effectiveFormat(f, schema);
      return [f.name, format === f.format ? f : { ...f, format }];
    }),
  );
}

export function visibleFields(view: View, schema: TableSchema): string[] {
  return view.fields ?? schema.fields.map((f) => f.name);
}

/**
 * Rows in the order a grouped view shows them (SPEC section 4, `group`),
 * each marked with the group it starts, if any. Ungrouped: as they are.
 */
export function groupedRows(
  view: View,
  rows: Row[],
  schema: TableSchema,
): { row: Row; starts?: { label: string; count: number } }[] {
  const field = view.group?.field;
  if (!field) return rows.map((row) => ({ row }));
  const def = schema.fields.find((f) => f.name === field);
  const options = enumOptions(def);
  const out: { row: Row; starts?: { label: string; count: number } }[] = [];
  for (const [key, members] of Object.entries(applyGroup(rows, field, schema))) {
    if (members.length === 0) continue;
    const label = key === "(empty)" ? EMPTY_GROUP : (options.find((o) => o.value === key)?.label ?? key);
    members.forEach((row, i) => out.push(i === 0 ? { row, starts: { label, count: members.length } } : { row }));
  }
  return out;
}

export const TOTAL_LABELS: Record<ViewTotal, string> = {
  sum: "Sum",
  average: "Avg",
  min: "Min",
  max: "Max",
  count: "Count",
  count_empty: "Empty",
};
export const TOTAL_NAMES: Record<ViewTotal, string> = {
  sum: "Sum",
  average: "Average",
  min: "Smallest",
  max: "Largest",
  count: "Count values",
  count_empty: "Count empty",
};

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return EMPTY_TEXT;
  if (value instanceof FormulaError) return value.code;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export function bodyExcerpt(body: string | undefined, max = 160): string | undefined {
  if (!body) return undefined;
  const stripped = body
    .replace(/^#+\s+/gm, "") // drop leading markdown heading hashes
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * A related row's label, as a relation cell shows it: the target table's
 * primary key when it declares one, else its first text field (its title,
 * in practice), else the id. Null when the row can't be found: no related
 * table loaded, or the row isn't in it. Only that is broken.
 */
export function relationLabel(
  relation: { table: string; field: string },
  targetId: string,
  relatedTables: Record<string, ParsedTable> | undefined,
): string | null {
  const target = relatedTables?.[relation.table];
  const targetRow = target?.rows.find((r) => r.id === targetId);
  if (!targetRow) return null;
  const labelField =
    target?.schema.primaryKey?.[0] ??
    target?.schema.fields.find((f) => f.type === "string" && !f.relation && !f.deprecated)?.name;
  return String((labelField ? targetRow[labelField] : undefined) ?? targetId);
}

/** One related row in a cell: its label (null when dangling) and its address. */
export interface RelationLink {
  id: string;
  label: string | null;
  /** `<table-path>#row=<id>` (SPEC "Addressing"), for `onOpenRelation`. */
  address: string;
}

/** A choice as the schema describes it: its label, and its colour if it has one. */
export interface Pill {
  value: unknown;
  label: string;
  color?: string;
}

/**
 * What a cell shows, decided once for every renderer. Each draws these
 * its own way (a span, a GTK label), but which one a value is, and its
 * text, are the same everywhere.
 */
export type CellShow =
  | { kind: "relations"; links: RelationLink[] }
  | { kind: "error"; code: string }
  | { kind: "pills"; pills: Pill[] }
  | { kind: "attachment"; fileName: string }
  | { kind: "link"; text: string; href: string; external: boolean }
  /**
   * Plain text. `oneToken` is a number or date: in a narrow column it
   * ends "US$18…" on one line, never wraps to a fragment the row clips.
   */
  | { kind: "text"; text: string; oneToken: boolean };

/** A choice's pill: its label and colour when the schema gives them. */
export function pillFor(field: Field | undefined, value: unknown): Pill {
  const option = enumOptions(field).find((o) => o.value === value);
  return { value, label: option?.label ?? String(value), ...(option?.color ? { color: option.color } : {}) };
}

function linkFor(relation: { table: string; field: string }, id: string, relatedTables: Record<string, ParsedTable> | undefined): RelationLink {
  return { id, label: relationLabel(relation, id, relatedTables), address: formatAddress({ tablePath: relation.table, rowId: id }) };
}

/** What `value`, stored in `field`, shows as. */
export function describeCell(
  field: Field | undefined,
  value: unknown,
  display: DisplayOptions,
  relatedTables?: Record<string, ParsedTable>,
): CellShow {
  // A relation: the related row, or its id marked broken when dangling.
  if (field?.relation && typeof value === "string" && value.length > 0) {
    return { kind: "relations", links: [linkFor(field.relation, value, relatedTables)] };
  }
  // A formula that failed shows its spreadsheet-style code (#DIV/0!).
  if (value instanceof FormulaError) return { kind: "error", code: value.code };
  // A list: each item a pill, in its choice's colour for a multi-select (D35).
  if (Array.isArray(value) && !field?.relation) {
    if (value.length === 0) return { kind: "text", text: EMPTY_TEXT, oneToken: false };
    return { kind: "pills", pills: value.map((item) => pillFor(field, item)) };
  }
  const isEnum = field?.constraints?.enum != null;
  if (isEnum && value !== undefined && value !== null && value !== "") {
    return { kind: "pills", pills: [pillFor(field, value)] };
  }
  // Many related rows: one link each (cardinality "many", SPEC section 2).
  if (field?.relation && Array.isArray(value)) {
    return { kind: "relations", links: value.map((id) => linkFor(field.relation!, String(id), relatedTables)) };
  }
  // An attachment: its filename, drawn as the image when the app can
  // resolve it (SPEC section 6 leaves resolving to the app).
  if (field?.attachment && typeof value === "string" && value !== "") {
    return { kind: "attachment", fileName: value };
  }
  // url / email / phone are links (SPEC "Field format").
  const kind = stringFormatKind(field);
  if ((kind === "url" || kind === "email" || kind === "phone") && typeof value === "string" && value !== "") {
    const href = kind === "url" ? value : kind === "email" ? `mailto:${value}` : `tel:${value.replace(/[^+\d]/g, "")}`;
    return { kind: "link", text: value, href, external: kind === "url" };
  }
  // A declared display format (currency:USD, decimal:2, …) is honoured;
  // the stored value is untouched (SPEC "Field format"). A date with no
  // format of its own takes the app's default, in the app's locale.
  const isDate = field?.type === "date" || field?.type === "datetime";
  const oneToken = isDate || field?.type === "number" || field?.type === "integer" || field?.type === "year";
  if ((field?.format || isDate) && value !== undefined && value !== null && value !== "") {
    return { kind: "text", text: formatWithFieldFormat(field, value, display), oneToken };
  }
  return { kind: "text", text: formatValue(value), oneToken };
}

/**
 * A totals footer cell (SPEC section 4, `totals`): the calculation over
 * the rows shown, rounded to cents for an average. `numeric` totals are
 * shown in the field's own format; counts are shown as they are.
 */
export function totalFor(rows: Row[], name: string, kind: ViewTotal): { value: unknown; numeric: boolean } {
  const value = viewTotal(rows, name, kind);
  const numeric = kind === "sum" || kind === "average" || kind === "min" || kind === "max";
  const shown = kind === "average" && typeof value === "number" ? Math.round(value * 100) / 100 : value;
  return { value: shown, numeric };
}

/**
 * A choice's colours by the schema's symbolic name (SPEC "enum colours", DECISIONS D43),
 * light and dark: `bg` behind the label, `fg` for it. Unknown names and
 * no colour use `gray`. The web views restate these as literals, because
 * StyleX compiles only values written in its own file; change both.
 */
export const PILL_PALETTE: Record<string, { light: { bg: string; fg: string }; dark: { bg: string; fg: string } }> = {
  gray: { light: { bg: "#e8e8ed", fg: "#3a3a3c" }, dark: { bg: "#2c2c31", fg: "#e5e5ea" } },
  brown: { light: { bg: "#eee3d8", fg: "#7a4a21" }, dark: { bg: "#3b2a1d", fg: "#d9b08c" } },
  red: { light: { bg: "#fde2e1", fg: "#b42318" }, dark: { bg: "#4a1f1f", fg: "#ff8a80" } },
  orange: { light: { bg: "#fde8d4", fg: "#b54708" }, dark: { bg: "#4a2c14", fg: "#ffb86b" } },
  yellow: { light: { bg: "#fdf3c4", fg: "#7a5f00" }, dark: { bg: "#433a10", fg: "#f5d565" } },
  lime: { light: { bg: "#eaf5cc", fg: "#4d6b00" }, dark: { bg: "#2b3a10", fg: "#c3e56a" } },
  green: { light: { bg: "#dcf5e3", fg: "#1f7a2c" }, dark: { bg: "#16341f", fg: "#7ee08a" } },
  mint: { light: { bg: "#d8f5ea", fg: "#0b6b4d" }, dark: { bg: "#12362b", fg: "#7fe3c0" } },
  teal: { light: { bg: "#d4f1f2", fg: "#0e6b73" }, dark: { bg: "#10353a", fg: "#76dde6" } },
  cyan: { light: { bg: "#d6eefb", fg: "#075985" }, dark: { bg: "#0f3447", fg: "#7cd3f7" } },
  blue: { light: { bg: "#dde9fd", fg: "#1d4ed8" }, dark: { bg: "#15284a", fg: "#8ab4ff" } },
  indigo: { light: { bg: "#e1e4fb", fg: "#4338ca" }, dark: { bg: "#1f2347", fg: "#a5adff" } },
  purple: { light: { bg: "#ece3fd", fg: "#6d28d9" }, dark: { bg: "#2d1f4a", fg: "#c4a8ff" } },
  pink: { light: { bg: "#fce1f0", fg: "#be185d" }, dark: { bg: "#4a1f36", fg: "#ff9ecb" } },
};

/** A choice's pair by name; no colour, or a name not in the palette, is gray (SPEC section 4). */
export function pillColors(color: string | undefined): (typeof PILL_PALETTE)[string] {
  return color !== undefined && Object.hasOwn(PILL_PALETTE, color) ? PILL_PALETTE[color]! : PILL_PALETTE["gray"]!;
}

/** Default column width, and the narrowest one fills to (web `MIN_CELL_WIDTH`). */
export const MIN_CELL_WIDTH = 180;
/** Narrowest a column can be dragged. */
export const MIN_RESIZED_COLUMN_WIDTH = 60;
/** A sheet's row-number gutter (`coordinates`). */
export const ROW_NUMBER_WIDTH = 32;

/**
 * Each column's width in a table of `containerWidth`, less `chrome` (the
 * borders, a frozen column's divider, a sheet's row numbers). Columns the
 * viewer resized keep their width (never below MIN_RESIZED_COLUMN_WIDTH);
 * the rest share what's left, never narrower than MIN_CELL_WIDTH. When
 * they fill the table the `floor()` remainder goes a pixel at a time to
 * the leftmost, so the columns sum exactly to the width: no hairline gap
 * before the border. Narrower than that, the table overflows and scrolls.
 * An unmeasured container (0) gives every flexible column MIN_CELL_WIDTH.
 */
export function columnWidths(
  fields: string[],
  setWidths: Record<string, number | undefined>,
  containerWidth: number,
  chrome: number,
): (name: string) => number {
  const fixedWidth = (name: string) => {
    const w = setWidths[name];
    return typeof w === "number" ? Math.max(MIN_RESIZED_COLUMN_WIDTH, w) : undefined;
  };
  const flexible = fields.filter((name) => fixedWidth(name) === undefined);
  const fixedTotal = fields.reduce((sum, name) => sum + (fixedWidth(name) ?? 0), 0);
  const available = Math.max(0, containerWidth - chrome - fixedTotal);
  const rawWidth = flexible.length > 0 && containerWidth > 0 ? Math.floor(available / flexible.length) : MIN_CELL_WIDTH;
  const fills = rawWidth >= MIN_CELL_WIDTH;
  const cellW = fills ? rawWidth : MIN_CELL_WIDTH;
  const remainder = fills ? available - cellW * flexible.length : 0;
  return (name: string) => {
    const fixed = fixedWidth(name);
    if (fixed !== undefined) return fixed;
    const i = flexible.indexOf(name);
    return cellW + (i >= 0 && i < remainder ? 1 : 0);
  };
}

/** What an empty cell shows, and a choice picker's "no value" option. */
export const EMPTY_TEXT = "—";

/** A group, or board column, of rows with no value. */
export const EMPTY_GROUP = "Empty";

/** A column dragged `delta` wider (narrower when negative) from `size`: whole pixels, never below MIN_RESIZED_COLUMN_WIDTH. */
export function resizedColumnWidth(size: number, delta: number): number {
  return Math.max(MIN_RESIZED_COLUMN_WIDTH, Math.round(size + delta));
}

/** Rows dragged `delta` taller from `size`: whole pixels, between MIN_ROW_HEIGHT and MAX_ROW_HEIGHT. */
export function resizedRowHeight(size: number, delta: number): number {
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(size + delta)));
}

/** The most lines a row can be resized to show, within MAX_ROW_HEIGHT. */
export const MAX_ROW_LINES = Math.floor((MAX_ROW_HEIGHT - DEFAULT_ROW_HEIGHT) / CELL_LINE_HEIGHT) + 1;

/** The height of a row showing `lines` lines: one line is the default height, and each more adds a line. */
export function heightForLines(lines: number): number {
  const n = Math.min(MAX_ROW_LINES, Math.max(1, Math.round(lines)));
  return DEFAULT_ROW_HEIGHT + (n - 1) * CELL_LINE_HEIGHT;
}

/** A row's height in a view: its own (rowHeights), else the view's default (rowHeight), else one line. */
export function rowHeightOf(view: { rowHeight?: number; rowHeights?: Record<string, number> }, rowId: string): number {
  return view.rowHeights?.[rowId] ?? view.rowHeight ?? DEFAULT_ROW_HEIGHT;
}

/**
 * A row dragged `delta` taller from `size`, in whole lines: cells clip to
 * whole lines, so a height between two would only add empty space.
 */
export function snappedRowHeight(size: number, delta: number): number {
  return heightForLines((size + delta - DEFAULT_ROW_HEIGHT) / CELL_LINE_HEIGHT + 1);
}

// An estimate of the cell font's average character width (13px system
// text) and its side padding, for fitting a row to what it holds without
// measuring it on screen.
const AVERAGE_CHAR_WIDTH = 6.5;
const CELL_PADDING_INLINE = 16;
// What a pill or link adds around its label: its own padding and the gap.
const ITEM_EXTRA_WIDTH = 24;

/** Lines `show` needs in a column `width` wide, estimated. */
export function linesNeeded(show: CellShow, width: number): number {
  const room = Math.max(1, width - 2 * CELL_PADDING_INLINE);
  const wrap = (text: string) =>
    text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * AVERAGE_CHAR_WIDTH) / room)), 0);
  switch (show.kind) {
    case "text":
      return show.oneToken ? 1 : wrap(show.text);
    case "link":
      return wrap(show.text);
    case "pills":
    case "relations": {
      // Items flow left to right and wrap to a new line when full.
      const widths = (show.kind === "pills" ? show.pills.map((p) => p.label) : show.links.map((l) => l.label)).map(
        (label) => Math.min(room, (label ?? "").length * AVERAGE_CHAR_WIDTH + ITEM_EXTRA_WIDTH),
      );
      let lines = 1;
      let used = 0;
      for (const w of widths) {
        if (used > 0 && used + w > room) {
          lines += 1;
          used = 0;
        }
        used += w;
      }
      return lines;
    }
    default:
      return 1;
  }
}

/** The height that shows all of a row's cells (each with its column's width), within MAX_ROW_HEIGHT. */
export function fittedRowHeight(cells: { show: CellShow; width: number }[]): number {
  return heightForLines(cells.reduce((most, c) => Math.max(most, linesNeeded(c.show, c.width)), 1));
}

