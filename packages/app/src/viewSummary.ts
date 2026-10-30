// The line under a view's name, as plain data: how many rows are showing,
// whether every row fits the schema, and whether the schema changed since
// the table was opened (D22). Each app draws it; the wording is here, so
// they all say the same thing.

import { validate, type ParsedTable, type ValidationError } from "@workspace.sh/table-core";

export interface ViewSummary {
  /** `3 of 6 rows`, or `2 of 5 matching` while searching; `81 of 180 rows · Filtered by Read` when the view's filter hides rows (#595). */
  count: string;
  /** While searching, what was found, short enough for the search field: `2 rows`, `1 row`, `No rows`. */
  found?: string;
  /** Every row fits the schema. */
  valid: boolean;
  /** `schema valid`, or `2 validation errors`. */
  validity: string;
  /** What `validity` means: the rule, or the first few errors a line each. */
  validityHint: string;
  /** The schema-version went up since the table was opened (D22). */
  schemaChanged: boolean;
  /** Shown beside it as `schema changed`, with `schemaChangedHint`. */
  schemaChangedLabel: string;
  schemaChangedHint: string;
  /** The validation errors themselves, for an app that lists them its own way. */
  errors: ValidationError[];
  /**
   * A large table held in memory because its index couldn't be made: said
   * beside the count (`held in memory`, with why as its hint), on the table
   * itself, never as an alert to answer (workspace#711).
   */
  held?: { label: string; hint: string };
}

export interface ViewSummaryInput {
  /** Rows showing now, after the view's filters and any search. */
  shown: number;
  /** Rows the view shows before searching: what a search is out of. */
  inView: number;
  /** The search box has text in it. */
  searching: boolean;
  /** The table's schema-version when it was opened, from `schemaVersionOf`. */
  openedAt?: number;
  /** Why the table is held in memory, when its index couldn't be made (heldText). */
  held?: string;
  /** The fields the view's filter reads, by name: said beside the count when it hides rows. */
  filteredBy?: readonly string[];
}

/** A count as the reader writes numbers: `1,000,000` in English, as the reading line says them. */
const counted = (n: number) => n.toLocaleString();

/** How many filtered fields are named before it says only `Filtered`. */
const NAMED_FILTERS = 2;

/**
 * Why rows are missing, when the view's filter hides some: `Filtered by
 * Read`, `Filtered by Read and Status`, or `Filtered` past two fields. A
 * search says its own count, out of the rows the filter left.
 */
function filterText(table: ParsedTable, input: ViewSummaryInput, total: number): string {
  if (input.searching || input.inView >= total || !input.filteredBy?.length) return "";
  const names = [...new Set(input.filteredBy)].map((name) => table.schema.fields.find((f) => f.name === name)?.title ?? name);
  return names.length > NAMED_FILTERS ? " · Filtered" : ` · Filtered by ${names.join(" and ")}`;
}

/** `3 of 6 rows`, or `2 of 5 matching` while searching, with why rows are hidden. */
const countText = (table: ParsedTable, input: ViewSummaryInput, total: number) =>
  input.searching
    ? `${counted(input.shown)} of ${counted(input.inView)} matching`
    : `${counted(input.shown)} of ${counted(total)} ${total === 1 ? "row" : "rows"}${filterText(table, input, total)}`;

/** What a search found, for the search field itself. */
const foundText = (input: ViewSummaryInput) =>
  !input.searching ? undefined : input.shown === 0 ? "No rows" : `${counted(input.shown)} ${input.shown === 1 ? "row" : "rows"}`;

/** How many errors the hint lists before `…and N more`. */
const HINT_ERRORS = 5;

export function viewSummary(table: ParsedTable, input: ViewSummaryInput): ViewSummary {
  const held = input.held ? { held: { label: "held in memory", hint: input.held } } : {};
  const errors = validate(table.schema, table.rows);
  // Rows held in the index aren't here to count, or to check.
  const total = table.indexed ? table.indexed.count : table.rows.length;
  const valid = errors.length === 0;
  if (table.indexed) {
    return {
      count: countText(table, input, total),
      found: foundText(input),
      valid: true,
      validity: "not checked",
      validityHint: "A table this large is read through its index, and its rows aren't checked against the schema one by one.",
      schemaChanged: schemaVersionOf(table) > (input.openedAt ?? 1),
      schemaChangedLabel: "schema changed",
      schemaChangedHint:
        "A column was added, moved, retyped or given new rules since this table was opened. The table's schema-version goes up by one for each such change (D22).",
      errors,
      ...held,
    };
  }
  return {
    count: countText(table, input, total),
      found: foundText(input),
    valid,
    validity: valid ? "schema valid" : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`,
    validityHint: valid
      ? "Every row fits the schema: required fields are filled, choices are from their lists, and values are the right type."
      : errors
          .slice(0, HINT_ERRORS)
          .map((e) => `${e.field ?? "row"}: ${e.message}`)
          .join("\n") + (errors.length > HINT_ERRORS ? `\n…and ${errors.length - HINT_ERRORS} more` : ""),
    schemaChanged: schemaVersionOf(table) > (input.openedAt ?? 1),
    schemaChangedLabel: "schema changed",
    schemaChangedHint:
      "A column was added, moved, retyped or given new rules since this table was opened. The table's schema-version goes up by one for each such change (D22).",
    errors,
    ...held,
  };
}

/** A table's schema-version: 1 when it has none (D22). */
export function schemaVersionOf(table: ParsedTable): number {
  const v = table.schema["schema-version"];
  return typeof v === "number" ? v : 1;
}

/** Each table's schema-version as opened, by key: what `openedAt` compares with. */
export function schemaVersions(tables: Record<string, ParsedTable>): Record<string, number> {
  return Object.fromEntries(Object.entries(tables).map(([key, t]) => [key, schemaVersionOf(t)]));
}
