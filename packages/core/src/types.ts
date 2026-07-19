// ---- Schema ----

export type FieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "year"
  | "array"
  | "object"
  | "duration"
  | "geopoint"
  | "geojson";

/**
 * Symbolic enum-chip color — the 8-color Notion / Linear palette.
 * Symbolic (not hex) so each consumer maps the name onto its own
 * light/dark theme. See SPEC "Field constraints → enum".
 */
export type EnumColor =
  | "gray"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink";

/**
 * Rich enum entry. The on-disk `enum` array may hold bare strings
 * (legacy / minimal form) or these objects; readers normalise both
 * via `enumOptions()`. Only `value` participates in validation and
 * sort/group order — `color` and `label` are display-only.
 */
export interface EnumOption {
  value: string;
  color?: EnumColor;
  label?: string;
}

export interface FieldConstraints {
  required?: boolean;
  unique?: boolean;
  /**
   * Allowed values. Each entry is either a bare string or an
   * `EnumOption` carrying display metadata (color, label). Mixed
   * arrays are legal. Normalise with `enumOptions()` / `enumValues()`
   * rather than reading this directly.
   */
  enum?: (string | EnumOption)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export type FieldAlignment = "left" | "center" | "right";

export interface Field {
  name: string;
  type: FieldType;
  title?: string;
  /** Hover-help / accessibility text. Display-only, passthrough. */
  description?: string;
  /**
   * Display-semantic hint from a closed vocabulary (SPEC "Field
   * format"). Interpretation depends on `type`: number
   * (`decimal:2`, `percent`, `currency:USD`, …), date (`short`,
   * `long`, `relative`, …), string (`markdown`, `url`, `email`, …).
   * Stored values stay raw; `format` only declares the semantic.
   * Render with `formatValue()`; unknown formats fall back to plain.
   */
  format?: string;
  /**
   * Emoji or symbolic name (`"calendar"`, `"money"`) shown beside the
   * field title. Display-only; consumers MAY ignore.
   */
  icon?: string;
  /**
   * Display alignment for the field's values. Optional; when absent,
   * readers use the per-type default (numerics right, booleans center,
   * everything else left). Setting this explicitly overrides the default.
   * Purely cosmetic — does not affect data validation or storage.
   */
  align?: FieldAlignment;
  constraints?: FieldConstraints;
  attachment?: boolean;
  relation?: {
    table: string;
    field: string;
    /**
     * `"one"` (default) — the row value is a single target id.
     * `"many"` — the row value is an array of target ids. Absent is
     * equivalent to `"one"` (backwards compatible).
     */
    cardinality?: "one" | "many";
  };
  /**
   * RESERVED — computed / formula field. Not yet implemented; readers
   * MUST tolerate its presence (a computed field with no evaluator
   * simply renders empty). See SPEC "Computed fields (reserved)" and
   * DECISIONS D21. Shape is provisional until an evaluator lands.
   */
  computed?: {
    expr: string;
    dialect: string;
  };
  deprecated?: boolean;
  [key: string]: unknown;
}

/**
 * Normalise a field's `enum` constraint to `EnumOption[]`, coercing
 * bare strings to `{ value }`. Returns `[]` when the field has no enum.
 * The single reader all consumers (validator, sort/group, UI chips)
 * should go through so both on-disk forms behave identically.
 */
export function enumOptions(field: Field | undefined): EnumOption[] {
  const raw = field?.constraints?.enum;
  if (!raw) return [];
  return raw.map((e) => (typeof e === "string" ? { value: e } : e));
}

/**
 * Just the enum values, in declared order — for membership checks and
 * enum-ordered sort/group. Strips the display metadata.
 */
export function enumValues(field: Field | undefined): string[] {
  return enumOptions(field).map((o) => o.value);
}

/**
 * Default display alignment for a given field type, following the
 * convention used by spreadsheet/database apps (Airtable, Sheets, etc.).
 * Numerics right-align so digits line up; booleans center; everything
 * else left.
 */
export function defaultAlignFor(type: FieldType): FieldAlignment {
  switch (type) {
    case "integer":
    case "number":
    case "year":
      return "right";
    case "boolean":
      return "center";
    default:
      return "left";
  }
}

/**
 * Resolve a field's effective alignment: the explicit `align` annotation
 * if present, otherwise the type-based default. Returns "left" when the
 * field is undefined.
 */
export function effectiveAlign(field: Field | undefined): FieldAlignment {
  if (!field) return "left";
  return field.align ?? defaultAlignFor(field.type);
}

export interface TableSchema {
  fields: Field[];
  primaryKey?: string[];
  missingValues?: string[];
  "schema-version"?: number;
  [key: string]: unknown;
}

// ---- Rows ----

export type Row = Record<string, unknown> & { id: string };

// ---- Views ----

export type ViewLayout = "table" | "board" | "gallery" | "calendar" | "list";

export type FilterOperator =
  | "eq" | "neq"
  | "gt" | "gte" | "lt" | "lte"
  | "contains" | "not_contains"
  | "starts_with" | "ends_with"
  | "empty" | "not_empty"
  | "in" | "not_in";

export interface ViewFilter {
  field: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface ViewSort {
  field: string;
  direction: "asc" | "desc";
}

export interface ViewGroup {
  field: string;
}

export interface View {
  id: string;
  name: string;
  layout: ViewLayout;
  fields?: string[];
  filter?: ViewFilter[];
  sort?: ViewSort[];
  group?: ViewGroup;
  /**
   * Manual row ordering by system id. When present and non-empty, takes
   * precedence over `sort` for the listed rows; rows not in the array
   * appear after, in their natural arrival order. Set by manual reorder
   * gestures (drag-and-drop in list/board-within-column views).
   */
  order?: string[];
  /**
   * Per-column widths in pixels, keyed by field name. Columns not listed
   * use the default flex distribution. Purely cosmetic — does not affect
   * data or schema. Set by column-resize gestures in table views.
   */
  columnWidths?: Record<string, number>;
  board_field?: string;
  gallery_field?: string;
  calendar_field?: string;
  /**
   * Optional date-range bound on `layout: "calendar"` views. When set,
   * the calendar's prev / next navigation is locked to this window —
   * the user can't browse before `start` or after `end`. Initial cursor
   * snaps inside the range.
   *
   * Use cases: a project calendar locked to the project's duration,
   * a sprint view locked to a 2-week cycle, an event calendar locked
   * to the event week. None of Notion / Airtable / Google Calendar
   * supports this natively (they use filters to achieve a similar
   * effect); we surface it as a first-class view property because
   * Workspace's project-shaped use cases want it cheap.
   *
   * Dates are YYYY-MM-DD strings. Inclusive on both ends at month
   * granularity (cursor is clamped to first-of-month within the
   * range).
   */
  calendar_range?: { start: string; end: string };
  [key: string]: unknown;
}

// ---- Meta ----

export interface TableMeta {
  format?: "table";
  formatVersion?: number;
  title?: string;
  description?: string;
  created_at?: string;
  modified_at?: string;
  generator?: string;
  [key: string]: unknown;
}

export const TABLE_FORMAT_VERSION = 1;

// ---- Parsed Table ----

export interface ParsedTable {
  schema: TableSchema;
  rows: Row[];
  views: View[];
  meta: TableMeta;
  /**
   * Optional long-form markdown bodies, keyed by row.id.
   * Each entry corresponds to a `bodies/{id}.md` file.
   * Rows without a body simply have no entry here.
   */
  bodies?: Record<string, string>;
  path: string;
}
