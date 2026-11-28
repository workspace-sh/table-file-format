// The line under a view's name, as plain data: how many rows are showing,
// whether every row fits the schema, and whether the schema changed since
// the table was opened (D22). Each app draws it; the wording is here, so
// they all say the same thing.

import { checkErrors, checkState, problemsOf, type ParsedTable, type Problem, type ValidationError } from "@workspace.sh/table-core";

export interface ViewSummary {
  /** `3 of 6 rows`, or `2 of 5 matching` while searching; `81 of 180 rows · Filtered by Read` when the view's filter hides rows (#595). */
  count: string;
  /** The rows `count` says are shown, and out of how many: the view's (the search's while searching). As numbers, for an app to compare; `count` is for reading. */
  shown: number;
  total: number;
  /** While searching, what was found, short enough for the search field: `2 rows`, `1 row`, `No rows`. */
  found?: string;
  /** The table is valid (SPEC section 9), and its reader kept no line it couldn't use. True too when it isn't known (`standing` "unchecked"). */
  valid: boolean;
  /**
   * What's known of its rows: they fit ("valid", drawn green), they don't ("invalid", red), or
   * they haven't been checked, or not since an edit, or are being checked ("unchecked", drawn as
   * the row count is): a large table held in its index (#867).
   */
  standing: "valid" | "invalid" | "unchecked";
  /** `schema valid`, or `2 validation errors`: the problems that are errors. */
  validity: string;
  /** What `validity` means: the rule, or the first few errors a line each. */
  validityHint: string;
  /** The schema-version went up since the table was opened (D22). */
  schemaChanged: boolean;
  /** Shown beside it as `schema changed`, with `schemaChangedHint`. */
  schemaChangedLabel: string;
  schemaChangedHint: string;
  /** The errors among `problems`, as a line each, for an app that lists them its own way. */
  errors: ValidationError[];
  /** Every problem the table has, errors, warnings and notices, with their places and fixes (table-core's `problemsOf`). */
  problems: Problem[];
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

/**
 * A table's problems, found once for each table object: a table is never
 * changed in place (an edit makes a new one), so a view drawn again asks
 * nothing new.
 */
const found = new WeakMap<ParsedTable, { problems: Problem[]; errors: ValidationError[] }>();

function problemsFor(table: ParsedTable): { problems: Problem[]; errors: ValidationError[] } {
  let these = found.get(table);
  if (!these) {
    const problems = problemsOf(table, "");
    const lineOf = new Map(table.rows.map((r, i) => [r.id, i]));
    const errors = problems
      .filter((p) => p.severity === "error")
      .map((p): ValidationError => {
        const row = p.at.kind === "cell" || p.at.kind === "row" ? p.at.row : undefined;
        const field = p.at.kind === "cell" || p.at.kind === "field" ? p.at.field : undefined;
        return { rowIndex: row !== undefined ? (lineOf.get(row) ?? -1) : p.at.kind === "line" ? p.at.line : -1, ...(row !== undefined ? { rowId: row } : {}), ...(field !== undefined ? { field } : {}), message: p.message, code: p.code };
      });
    found.set(table, (these = { problems, errors }));
  }
  return these;
}

export function viewSummary(table: ParsedTable, input: ViewSummaryInput): ViewSummary {
  const held = input.held ? { held: { label: "held in memory", hint: input.held } } : {};
  const { problems, errors } = problemsFor(table);
  // Rows held in the index aren't here to count, or to check.
  const total = table.indexed ? table.indexed.count : table.rows.length;
  // A large table's rows checked as its index was made (#867): its errors counted there, the first of them listed.
  const state = table.indexed ? checkState(table) : "none";
  if (table.indexed && typeof state !== "object") {
    return {
      count: countText(table, input, total),
      shown: input.shown,
      total: input.searching ? input.inView : total,
      found: foundText(input),
      valid: true,
      standing: "unchecked",
      validity: state === "checking" ? "checking" : state === "since-edit" ? "not checked since edited" : "not checked",
      validityHint:
        state === "checking"
          ? "A table this large is read through its index, and its rows are being checked against the schema."
          : state === "since-edit"
            ? "A table this large is read through its index. Its rows were checked against the schema once the index was made, and haven't been since they or the schema were edited."
            : "A table this large is read through its index, and its rows aren't checked against the schema one by one.",
      schemaChanged: schemaVersionOf(table) > (input.openedAt ?? 1),
      schemaChangedLabel: "schema changed",
      schemaChangedHint:
        "A column was added, moved, retyped or given new rules since this table was opened. The table's schema-version goes up by one for each such change (D22).",
      errors,
      problems,
      ...held,
    };
  }
  // Checked as its index was made: how many errors there are is the check's, of which the first are listed.
  const count = typeof state === "object" ? checkErrors(state.check) + errors.filter((e) => e.code !== undefined && !(e.code in state.check.counts)).length : errors.length;
  const fits = count === 0;
  // A check that didn't follow links can't say the whole table fits.
  const links = typeof state === "object" && state.check.links?.length ? " · links not checked" : "";
  const linksHint = links ? "\nLinks to other tables weren't checked: their rows are another table's." : "";
  return {
    count: countText(table, input, total),
    shown: input.shown,
    total: input.searching ? input.inView : total,
    found: foundText(input),
    valid: fits,
    standing: fits ? "valid" : "invalid",
    validity: (fits ? "schema valid" : `${counted(count)} validation error${count === 1 ? "" : "s"}`) + links,
    validityHint: (fits
      ? "Every row fits the schema: required fields are filled, choices are from their lists, and values are the right type."
      : errors
          .slice(0, HINT_ERRORS)
          .map((e) => e.message)
          .join("\n") + (count > HINT_ERRORS ? `\n…and ${counted(count - Math.min(HINT_ERRORS, errors.length))} more` : "")) + linksHint,
    schemaChanged: schemaVersionOf(table) > (input.openedAt ?? 1),
    schemaChangedLabel: "schema changed",
    schemaChangedHint:
      "A column was added, moved, retyped or given new rules since this table was opened. The table's schema-version goes up by one for each such change (D22).",
    errors,
    problems,
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
