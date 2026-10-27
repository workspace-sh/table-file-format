// What every renderer of a view shows, whatever draws it: the web and
// native views here, and table-gtk on Linux. No platform code.

import {
  applyGroup,
  effectiveFormat,
  enumOptions,
  formatAddress,
  formatValue as formatWithFieldFormat,
  FormulaError,
  parseExpr,
  stringFormatKind,
  type FormulaSyntax,
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
/** A group's heading, from its key as applyGroup (and a ViewRows' groups) names it. */
export function groupLabel(key: string, field: string, schema: TableSchema): string {
  if (key === "(empty)") return EMPTY_GROUP;
  return enumOptions(schema.fields.find((f) => f.name === field)).find((o) => o.value === key)?.label ?? key;
}

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
  for (const [key, members] of applyGroup(rows, field, schema)) {
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

/** The totals a column can show: sums and the like for numbers, counts for anything. */
export function totalKindsFor(field: Field | undefined): ViewTotal[] {
  const isNumber = field?.type === "number" || field?.type === "integer" || field?.type === "year" || field?.computed !== undefined;
  return [...(isNumber ? (["sum", "average", "min", "max"] as ViewTotal[]) : []), "count", "count_empty"];
}

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
  /** A formula that failed: plain words, and its code where Excel style shows it (#685). */
  | ({ kind: "error" } & FormulaErrorShow)
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

/** How a failed formula shows in its cell (#685). */
export interface FormulaErrorShow {
  /** The spreadsheet code: `#DIV/0!`. */
  code: string;
  /** What the cell says, in every syntax: a few plain words ("Divides by zero"). */
  text: string;
  /** What the formula's panel says: the words, and in Excel style the code too ("Divides by zero · #DIV/0!"). */
  withCode: string;
  /** What went wrong, and where the fix is, for a hover or (with no hover) the selected cell's details. In Excel style it begins with the code. */
  explanation: string;
  /** What fixes it: the loop's "Repeat Until It Settles", or editing the formula. Both are in the formula's panel. */
  fix: "repeat" | "edit";
  /** Which kind of problem: each has its own mark, so a column of them can be read at a glance (ERROR_MARKS). */
  group: FormulaErrorGroup;
}

/**
 * The kinds of problem, by what fixing one takes: a loop to settle or
 * break; something the formula points at that's gone; an answer its column
 * can't hold; a calculation that can't be done.
 */
export type FormulaErrorGroup = "loop" | "missing" | "mismatch" | "calculation";

/**
 * Each kind's mark: an SF Symbol on iOS and the Mac, and on the web and
 * Linux a Lucide icon (https://lucide.dev, ISC licence), whose paths are
 * here (24 × 24, stroked 2 wide, round ends) so both draw the same one.
 */
export const ERROR_MARKS: Record<FormulaErrorGroup, { lucide: string; paths: readonly string[]; sf: string; label: string }> = {
  loop: {
    lucide: "refresh-cw",
    paths: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
    sf: "arrow.triangle.2.circlepath",
    label: "Loop",
  },
  missing: {
    lucide: "unlink",
    paths: [
      "m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",
      "m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",
      "M8 2v3",
      "M2 8h3",
      "M16 19v3",
      "M19 16h3",
    ],
    sf: "questionmark.square.dashed",
    label: "Missing",
  },
  mismatch: { lucide: "equal-not", paths: ["M5 9h14", "M5 15h14", "M19 5 5 19"], sf: "notequal", label: "Doesn't fit" },
  calculation: {
    lucide: "triangle-alert",
    paths: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
    sf: "exclamationmark.triangle",
    label: "Can't be worked out",
  },
};

/** What a column of each type holds, for "Not a date" and "this column holds dates". */
const HOLDS: Record<string, [not: string, holds: string]> = {
  string: ["Not text", "text"],
  number: ["Not a number", "numbers"],
  integer: ["Not a whole number", "whole numbers"],
  year: ["Not a year", "years"],
  boolean: ["Not true or false", "true or false"],
  date: ["Not a date", "dates"],
  datetime: ["Not a date and time", "dates and times"],
  time: ["Not a time", "times"],
  duration: ["Not a duration", "durations"],
  array: ["Not a list", "lists"],
  geopoint: ["Not a map point", "map points"],
  geojson: ["Not a map shape", "map shapes"],
};

const FIX = {
  repeat: "Open the formula to repeat the calculation until it settles.",
  edit: "Open the formula to change it.",
};

/**
 * A failed formula in plain words (#685), from its code and the evaluator's
 * message, which the TypeScript workbook and the EDN core word alike. The
 * cell says the words in either syntax; in Excel style the code a
 * spreadsheet user knows is in the hover and the formula's panel.
 */
export function formulaErrorShow(error: FormulaError, field: Field | undefined, syntax?: FormulaSyntax): FormulaErrorShow {
  const { code, message } = error;
  const excel = syntax !== "stored";
  const said = (group: FormulaErrorGroup, words: string, why: string, fix: "repeat" | "edit" = "edit"): FormulaErrorShow => ({
    group,
    code,
    text: words,
    withCode: excel ? `${words} · ${code}` : words,
    explanation: `${excel ? `${code}: ` : ""}${why} ${FIX[fix]}`,
    fix,
  });
  let m: RegExpExecArray | null;
  if (code === "#VALUE!" && (m = /^.+ can't hold (.+)$/s.exec(message))) {
    // Any JSON value but a number JSON can't write (D56).
    if (field?.type === "any") return said("mismatch", "Number too big", `The formula gave ${m[1]}, which a file can't store.`);
    const [not, holds] = field?.relation ? ["Not a list of rows", "links to rows"] : (HOLDS[field?.type ?? ""] ?? ["Wrong kind of value", `values of type ${field?.type}`]);
    return said("mismatch", not, `The formula gave ${m[1]}, and this column holds ${holds}.`);
  }
  if (code === "#DIV/0!") return said("calculation", "Divides by zero", "The formula divides by zero for this row.");
  if (code === "#NUM!") return said("mismatch", "Number too big", "The formula's answer is too large for a number.");
  if (code === "#NAME?" && (m = /^no field named (.+)$/s.exec(message))) {
    return said("missing", `No field "${m[1]}"`, `The formula reads "${m[1]}", and there's no field by that name.`);
  }
  if (code === "#NAME?" && (m = /^unknown function (.+)$/s.exec(message))) {
    return said("calculation", "Unknown function", `The formula calls "${m[1]}", which isn't a formula function.`);
  }
  if (code === "#REF!") {
    if (/ depends on itself$/.test(message)) {
      return said("loop", "Loops back on itself", "This formula reads itself, through the formulas it reads, so it has no answer.", "repeat");
    }
    if ((m = /^the Sheet view (.+) is sorted by its own places$/s.exec(message))) {
      return said("loop", "Loops back on itself", `The Sheet view "${m[1]}" is sorted by what its formulas give, so they have no answer.`);
    }
    if ((m = /^no table (.+)$/s.exec(message))) return said("missing", `No table "${m[1]}"`, `The formula reads the table "${m[1]}", and there's no table by that name.`);
    if ((m = /^no Sheet view (.+)$/s.exec(message))) return said("missing", `No view "${m[1]}"`, `The formula reads the Sheet view "${m[1]}", and there's no view by that name.`);
    if ((m = /^(.+) isn't a column of (.+)$/s.exec(message))) {
      return said("missing", "Column isn't in the view", `The formula reads "${m[1]}" by its place in "${m[2]}", and that view doesn't show it.`);
    }
    if (message === "that row is off the grid") return said("missing", "No row there", "The formula reads a place past the edge of its Sheet view.");
    if (message.startsWith("no row ")) return said("missing", "Row is gone", "The formula reads a row that's no longer there.");
  }
  const sentence = `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;
  // A function given too many or too few: "round takes 1–2 arguments".
  if (code === "#VALUE!" && / takes (?:no|[\d–-]+(?: or \d+)?) arguments?$/.test(message)) return said("calculation", "Wrong number of inputs", sentence);
  // Anything else (a function given the wrong kind of value): the evaluator's own words.
  return said("calculation", "Wrong kind of value", sentence);
}

/** Types whose values are never strings: one stored as a string was kept as typed (D65). */
const NOT_STRINGS = new Set(["number", "integer", "year", "boolean"]);

/**
 * A cell holding what was kept as typed (D65): a formula that can't be read (its cells are
 * empty, SPEC section 5), or a value the column's type can't hold. Null for anything else.
 */
export function keptAsTyped(field: Field | undefined, value: unknown): FormulaErrorShow | null {
  if (!field) return null;
  if (field.computed && (value === undefined || value === null)) {
    const read = parseExpr(field.computed.expr);
    if (read.ok) return null;
    const text = "Formula can't be read";
    return { code: "", text, withCode: text, explanation: `The formula was kept as typed, and it can't be read: ${read.message}. Open the formula to change it.`, fix: "edit", group: "calculation" };
  }
  if (!field.computed && typeof value === "string" && NOT_STRINGS.has(field.type)) {
    const [not, holds] = HOLDS[field.type]!;
    return { code: "", text: not, withCode: not, explanation: `“${value}” was kept as typed, and this column holds ${holds}. Edit the cell to change it.`, fix: "edit", group: "mismatch" };
  }
  return null;
}

/** What `value`, stored in `field`, shows as. */
export function describeCell(
  field: Field | undefined,
  value: unknown,
  display: DisplayOptions & { formulaSyntax?: FormulaSyntax },
  relatedTables?: Record<string, ParsedTable>,
): CellShow {
  // A relation: the related row, or its id marked broken when dangling.
  if (field?.relation && typeof value === "string" && value.length > 0) {
    return { kind: "relations", links: [linkFor(field.relation, value, relatedTables)] };
  }
  // A formula that failed: plain words, and its code in Excel style's hover and panel (#685).
  if (value instanceof FormulaError) return { kind: "error", ...formulaErrorShow(value, field, display.formulaSyntax) };
  // What was kept as typed and can't be used as it is (D65): the cell says so, rather than standing empty.
  const kept = keptAsTyped(field, value);
  if (kept) return { kind: "error", ...kept };
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
  return shownTotal(viewTotal(rows, name, kind), kind);
}

/** A total as its footer cell shows it, from the value viewTotal (or a ViewRows' totals) gave. */
export function shownTotal(value: number | undefined, kind: ViewTotal): { value: unknown; numeric: boolean } {
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

/**
 * How narrow columns may be made to keep a table whole in its space. A
 * table that would fit with its columns a little under the comfortable
 * width (`MIN_CELL_WIDTH`) is shown whole at that width; one that wouldn't
 * fit even so keeps the comfortable width and scrolls sideways.
 */
export const SQUEEZED_CELL_WIDTH = 140;

/**
 * How narrow a column of `field` may be squeezed to keep its table whole,
 * by what its cells hold: a checkbox needs room for its header, a choice's pill or a
 * date a little more, an amount room for its total ("SUM US$732,800.00"),
 * and the title or a text column the comfortable width. In a table that
 * doesn't fit, the columns that can spare it give their room first.
 */
/** How narrow a column of several choices or links may go: a tag of about ten letters and a "+N" fit. */
export const LIST_SQUEEZED_WIDTH = 170;

export function squeezedWidthOf(field: Field | undefined, schema: TableSchema, primary = false): number {
  if (primary || field === undefined) return MIN_CELL_WIDTH;
  if (field.type === "boolean") return 100;
  // A list (several choices, links to several rows) keeps room for a
  // tag or a name of a word or two and its "+N", on one line.
  if (field.type === "array" && (field.relation || enumOptions(field).length > 0)) return LIST_SQUEEZED_WIDTH;
  if (field.relation || field.attachment) return SQUEEZED_CELL_WIDTH;
  if (enumOptions(field).length > 0) return 110;
  switch (field.type) {
    case "date":
    case "time":
      return 110;
    case "datetime":
      return 150;
    case "integer":
    case "number": {
      const format = effectiveFormat(field, schema) ?? "";
      return format.startsWith("currency") ? 150 : 110;
    }
    case "string":
      return stringFormatKind(field) === "markdown" ? MIN_CELL_WIDTH : SQUEEZED_CELL_WIDTH;
    default:
      return SQUEEZED_CELL_WIDTH;
  }
}

/** The title column's natural width: room for a name of a few words. */
export const TITLE_CELL_WIDTH = 240;

/**
 * How wide a column of `field` grows, at most, when there's room: a table
 * stops at its columns' natural widths rather than stretching across a
 * wide window, as a spreadsheet's or Notion's does. The title has room for
 * a few words, a checkbox for its header, and the rest the comfortable
 * width, or their squeezed width when that's more.
 */
export function roomiestWidthOf(field: Field | undefined, schema: TableSchema, primary = false): number {
  if (primary) return TITLE_CELL_WIDTH;
  if (field?.type === "boolean") return squeezedWidthOf(field, schema);
  return Math.max(MIN_CELL_WIDTH, squeezedWidthOf(field, schema));
}

/**
 * Widths for `names` sharing `room`, each by its weight (`most`, its
 * natural width, or alike), none under its `least`: those whose share
 * would be less hold their least, and the rest share what's left, the
 * `floor()` remainder a pixel at a time to the leftmost. What the layout
 * does with columns that grow from nothing by their weights, each with a
 * least width (`columnShare`). Null when their leasts don't fit.
 */
function sharedOut(
  names: string[],
  room: number,
  least: (name: string) => number,
  most?: (name: string) => number,
): Map<string, number> | null {
  const out = new Map<string, number>();
  if (names.reduce((n, name) => n + least(name), 0) > room) return null;
  const weight = (name: string) => (most ? most(name) : 1);
  let open = [...names];
  let left = room;
  const weightOf = (them: string[]) => them.reduce((n, name) => n + weight(name), 0);
  for (;;) {
    const total = weightOf(open);
    const held = open.filter((name) => least(name) > (total > 0 ? (left * weight(name)) / total : 0));
    if (held.length === 0) break;
    for (const name of held) {
      out.set(name, least(name));
      left -= least(name);
    }
    open = open.filter((name) => !held.includes(name));
  }
  const total = weightOf(open);
  const shares = open.map((name) => (total > 0 ? Math.floor((left * weight(name)) / total) : 0));
  const remainder = Math.max(0, left - shares.reduce((n, w) => n + w, 0));
  open.forEach((name, i) => out.set(name, shares[i]! + (i < remainder ? 1 : 0)));
  return out;
}

/** The "+" for a new field: the width of its header cell after the last column, taken from the columns'. */
export const ADD_FIELD_WIDTH = 40;
/** A sheet's row-number gutter (`coordinates`): its narrowest, for up to three digits. */
export const ROW_NUMBER_WIDTH = 32;

/**
 * A sheet's row-number gutter, wide enough for its largest number on one
 * line: worked out once from how many rows there are (not from the rows on
 * screen), so it never changes as the table scrolls. 11-point tabular
 * figures, the gutter's padding either side and its line.
 */
export function rowNumberWidth(largest: number): number {
  const digits = String(Math.max(1, Math.floor(largest))).length;
  // Three digits fit the narrowest, as they always have; past that, each is a figure's
  // width (6.6 at 11 points), with the padding, the line and a point to spare.
  return digits <= 3 ? ROW_NUMBER_WIDTH : Math.ceil(digits * 6.6) + 14;
}

/**
 * Each column's width in a table of `containerWidth`, less `chrome` (the
 * borders, a frozen column's divider, a sheet's row numbers). Columns the
 * viewer resized keep their width (never below MIN_RESIZED_COLUMN_WIDTH);
 * the rest share what's left, never narrower than MIN_CELL_WIDTH, and
 * never narrower than they'd be with nothing resized: widening one column
 * makes the table wider (it scrolls), as in a spreadsheet, rather than
 * taking the room from the others; narrowing one gives them its room. When
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
  /** How narrow flexible columns may be made to keep the table whole; the comfortable width when not given (no squeezing). */
  squeezeTo: number = MIN_CELL_WIDTH,
  /**
   * What they're given when the table can't be whole even squeezed: the
   * comfortable width, or (`squeezeTo`) the squeezed one, held as the
   * table starts to scroll, so its columns don't grow as its space shrinks.
   */
  past: number = MIN_CELL_WIDTH,
  /**
   * Each column's own squeezed width (`squeezedWidthOf`), in place of
   * `squeezeTo`: the table is whole while their sum fits, the columns that
   * would be narrower than theirs holding it; past that, each has its own
   * (`past` squeezed) or the comfortable width, and the table scrolls.
   */
  least?: (name: string) => number,
  /**
   * Each column's natural width (`roomiestWidthOf`): with room to spare
   * they stop there, and the table is narrower than its space; with less,
   * they share it by these widths, so each gives up room alike.
   */
  most?: (name: string) => number,
): (name: string) => number {
  if (least) return columnWidthsByLeast(fields, setWidths, containerWidth, chrome, past, least, most);
  if (most) {
    const even = columnWidths(fields, setWidths, containerWidth, chrome, squeezeTo, past);
    return (name) => (typeof setWidths[name] === "number" ? even(name) : Math.min(even(name), Math.max(most(name), MIN_CELL_WIDTH)));
  }
  const fixedWidth = (name: string) => {
    const w = setWidths[name];
    return typeof w === "number" ? Math.max(MIN_RESIZED_COLUMN_WIDTH, w) : undefined;
  };
  const flexible = fields.filter((name) => fixedWidth(name) === undefined);
  const fixedTotal = fields.reduce((sum, name) => sum + (fixedWidth(name) ?? 0), 0);
  const available = Math.max(0, containerWidth - chrome - fixedTotal);
  // Whole in its space when it can be, down to the squeezed width; past that, comfortable and scrolling.
  const shared = (room: number, count: number) => {
    const raw = count > 0 && containerWidth > 0 ? Math.floor(room / count) : MIN_CELL_WIDTH;
    return raw >= Math.min(squeezeTo, MIN_CELL_WIDTH) ? raw : past;
  };
  // What each column would be with none resized: the least a flexible one is given.
  const unresized = shared(Math.max(0, containerWidth - chrome), fields.length);
  // What is left, shared out: theirs when it is more than that, as when a column was narrowed. Less, and they
  // stay as they were (squeezed too: a squeezed table's columns don't jump to the comfortable width).
  const leftover = flexible.length > 0 && containerWidth > 0 ? Math.floor(available / flexible.length) : 0;
  const cellW = Math.max(unresized, leftover);
  // Filling the table exactly (not wider), the floor's remainder goes a pixel at a time to the leftmost:
  // of the columns sharing what is left, or, staying as they were, of all of them as when none was resized.
  const sharing = cellW === leftover;
  const among = sharing ? flexible : fields;
  const room = sharing ? available : Math.max(0, containerWidth - chrome);
  const remainder = Math.max(0, room - cellW * among.length);
  return (name: string) => {
    const fixed = fixedWidth(name);
    if (fixed !== undefined) return fixed;
    const i = among.indexOf(name);
    return cellW + (i >= 0 && i < remainder ? 1 : 0);
  };
}

/** `columnWidths` with a squeezed width for each column. */
function columnWidthsByLeast(
  fields: string[],
  setWidths: Record<string, number | undefined>,
  containerWidth: number,
  chrome: number,
  past: number,
  least: (name: string) => number,
  most?: (name: string) => number,
): (name: string) => number {
  const fixedWidth = (name: string) => {
    const w = setWidths[name];
    return typeof w === "number" ? Math.max(MIN_RESIZED_COLUMN_WIDTH, w) : undefined;
  };
  // Not fitting even squeezed: each its own squeezed width, or the comfortable one.
  const held = (name: string) => (past < MIN_CELL_WIDTH ? least(name) : Math.max(least(name), MIN_CELL_WIDTH));
  if (containerWidth <= 0) return (name) => fixedWidth(name) ?? MIN_CELL_WIDTH;
  const flexible = fields.filter((name) => fixedWidth(name) === undefined);
  const fixedTotal = fields.reduce((sum, name) => sum + (fixedWidth(name) ?? 0), 0);
  // With none resized, and sharing what the resized ones leave: a flexible
  // column has the more of the two, so widening one column widens the
  // table rather than taking the others' room.
  // No more room than their natural widths take: past that, the table stops.
  const roomFor = (them: string[], room: number) =>
    most ? Math.min(room, them.reduce((n, name) => n + Math.max(least(name), most(name)), 0)) : room;
  const unresized = sharedOut(fields, roomFor(fields, Math.max(0, containerWidth - chrome)), least, most);
  const leftover = sharedOut(flexible, roomFor(flexible, Math.max(0, containerWidth - chrome - fixedTotal)), least, most);
  return (name: string) => {
    const fixed = fixedWidth(name);
    if (fixed !== undefined) return fixed;
    const a = unresized?.get(name) ?? held(name);
    const b = leftover?.get(name);
    return b !== undefined ? Math.max(a, b) : a;
  };
}

/**
 * Whether the columns `columnWidths` gives fill the table exactly, as when
 * none is too wide to fit: then the columns nobody resized can share the
 * table's width as it changes, in the layout, rather than waiting to be
 * measured again (a window resized on a Mac). Not when the table is wider
 * than its room and scrolls, nor before it's measured, nor when every
 * column has been given a width.
 */
export function columnsFill(
  fields: string[],
  setWidths: Record<string, number | undefined>,
  containerWidth: number,
  chrome: number,
  squeezeTo: number = MIN_CELL_WIDTH,
): boolean {
  if (containerWidth <= 0) return false;
  if (!fields.some((name) => typeof setWidths[name] !== "number")) return false;
  const width = columnWidths(fields, setWidths, containerWidth, chrome, squeezeTo);
  const total = fields.reduce((sum, name) => sum + width(name), 0);
  return total === Math.max(0, containerWidth - chrome);
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

