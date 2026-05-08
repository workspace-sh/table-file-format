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

export interface FieldConstraints {
  required?: boolean;
  unique?: boolean;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface Field {
  name: string;
  type: FieldType;
  title?: string;
  description?: string;
  format?: string;
  constraints?: FieldConstraints;
  attachment?: boolean;
  relation?: {
    table: string;
    field: string;
  };
  deprecated?: boolean;
  [key: string]: unknown;
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

export type ViewLayout = "table" | "kanban" | "gallery" | "calendar" | "list";

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
  kanban_field?: string;
  gallery_field?: string;
  calendar_field?: string;
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
