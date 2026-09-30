// The line under a view's name, as plain data: how many rows are showing,
// whether every row fits the schema, and whether the schema changed since
// the table was opened (D22). Each app draws it; the wording is here, so
// they all say the same thing.

import { validate, type ParsedTable, type ValidationError } from "@workspace.sh/table-core";

export interface ViewSummary {
  /** `3 of 6 rows`, or `2 of 5 matching` while searching. */
  count: string;
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
}

/** How many errors the hint lists before `…and N more`. */
const HINT_ERRORS = 5;

export function viewSummary(table: ParsedTable, input: ViewSummaryInput): ViewSummary {
  const errors = validate(table.schema, table.rows);
  const total = table.rows.length;
  const valid = errors.length === 0;
  return {
    count: input.searching
      ? `${input.shown} of ${input.inView} matching`
      : `${input.shown} of ${total} ${total === 1 ? "row" : "rows"}`,
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
