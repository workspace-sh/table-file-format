// A table's edit history (SPEC section 14, DECISIONS D44): the events in
// `history.ndjson`, how the file is read and what is appended to it, and
// how a change to a row or its page is said as events. Nothing here
// touches a file: a writer appends what `serializeEditEvents` gives.
//
// (`history.ts` in table-app is Back and Forward. This is the other
// history: what was edited.)

import { newId } from "./id.js";
import { TableEntry } from "./layout.js";
import { normaliseBody } from "./serialize.js";
import type { CellFormula, Row } from "./types.js";

/** The history's file, in its table's folder: `tables/{name}/history.ndjson`. */
export const HISTORY_FILE = TableEntry.history;

/** One cell changed. `from` and `to` are the stored values; absent means empty (SPEC section 3). */
export interface SetChange {
  op: "set";
  row: string;
  field: string;
  from?: unknown;
  to?: unknown;
}

/** A row's cells' own formulas (D52): each cell's `cells/` line without `id` and `field`, by the field's name. */
export type RowCells = Record<string, Omit<CellFormula, "id" | "field">>;

/** A row was added: `values` is the row as written, and `cells` its cells' own formulas, when it has any. */
export interface InsertChange {
  op: "insert";
  row: string;
  values: Row;
  cells?: RowCells;
}

/** A row was removed: `values` is the whole row as it was, and `cells` its cells' own formulas, so it can be restored. */
export interface DeleteChange {
  op: "delete";
  row: string;
  values: Row;
  cells?: RowCells;
}

/** A cell's own formula set, changed or removed (D52): `from` and `to` are its `expr`, absent for none. */
export interface FormulaChange {
  op: "formula";
  row: string;
  field: string;
  from?: string;
  to?: string;
}

/** A row's page changed: the complete text before and after; absent for none. */
export interface PageChange {
  op: "page";
  row: string;
  from?: string;
  to?: string;
}

/** What happened, before it is given an id, a time and a writer. */
export type EditChange = SetChange | InsertChange | DeleteChange | PageChange | FormulaChange;

/** An event as `history.ndjson` holds it. */
export type EditEvent = EditChange & {
  /** Unique within the file. */
  id: string;
  /** RFC 3339, UTC. */
  at: string;
  /** Who wrote it: a name or a `did:key`. Opaque to the format. */
  by?: string;
};

/** An absent key, `null` and `""` are one thing: empty (SPEC section 3). */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function same(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (a === b) return true;
  // Stored values are JSON: a list or an object is the same when it is written the same.
  return typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b);
}

/** A row as `rows.ndjson` holds it: without the fields worked out from others. */
function stored(row: Row, computed: ReadonlySet<string> | undefined): Row {
  if (!computed || computed.size === 0) return row;
  const out: Row = { ...row };
  for (const name of computed) delete out[name];
  return out;
}

/**
 * What changed between a row as it was and as it is, as history says it:
 * an `insert` when it wasn't there, a `delete` when it has gone, and
 * otherwise a `set` for each cell that differs, in the order the fields
 * are met (the row as it is, then any only the old row had). Nothing
 * when nothing differs. `computed` names the fields that aren't stored
 * (formulas, lookups, rollups), which history doesn't record.
 */
export function rowChanges(before: Row | undefined, after: Row | undefined, computed?: ReadonlySet<string>): EditChange[] {
  if (!before && !after) return [];
  if (!before) return [{ op: "insert", row: after!.id, values: stored(after!, computed) }];
  if (!after) return [{ op: "delete", row: before.id, values: stored(before, computed) }];
  const changes: EditChange[] = [];
  for (const field of new Set([...Object.keys(after), ...Object.keys(before)])) {
    // A row's id is which row it is, not a cell.
    if (field === "id" || computed?.has(field)) continue;
    const from = before[field];
    const to = after[field];
    if (same(from, to)) continue;
    changes.push({ op: "set", row: after.id, field, ...(isEmpty(from) ? {} : { from }), ...(isEmpty(to) ? {} : { to }) });
  }
  return changes;
}

/**
 * A row's page changed from one text to another: null when it didn't. The
 * text is said as its file holds it (`bodies/{id}.md` ends in a newline),
 * so a page typed without one and its file are the same text. No text and
 * an empty one are the same: no page.
 */
export function pageChange(row: string, before: string | undefined, after: string | undefined): PageChange | null {
  const from = before ? normaliseBody(before) : "";
  const to = after ? normaliseBody(after) : "";
  if (from === to) return null;
  return { op: "page", row, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

export interface EditStamp {
  /** When it happened. Now, when not given. */
  at?: Date;
  /** Who did it. Left out of the events when the app has no name for them. */
  by?: string;
  /** An id for each event, unique within the file. A new random id, when not given. */
  id?: () => string;
}

/**
 * Changes made into events: each given an id, the time and who. The
 * keys are in the order the spec's examples have them, so a file reads
 * the same whichever app wrote it.
 */
export function stampEdits(changes: readonly EditChange[], stamp: EditStamp = {}): EditEvent[] {
  const at = (stamp.at ?? new Date()).toISOString();
  const id = stamp.id ?? newId;
  return changes.map((change) => {
    const { op, row, ...rest } = change;
    return { id: id(), at, ...(stamp.by ? { by: stamp.by } : {}), op, row, ...rest } as EditEvent;
  });
}

/**
 * Events as lines to append to `history.ndjson`: one JSON object a line,
 * each ending in a newline. The file is append-only, so this is all a
 * writer adds; a file that doesn't end in a newline is given one first.
 */
export function serializeEditEvents(events: readonly EditEvent[]): string {
  return events.map((event) => JSON.stringify(event) + "\n").join("");
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrAbsent = (value: unknown) => value === undefined || typeof value === "string";

/** An event this reader knows, whole enough to use. */
function readable(value: unknown): value is EditEvent {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || typeof value.at !== "string" || typeof value.row !== "string") return false;
  if (value.by !== undefined && typeof value.by !== "string") return false;
  switch (value.op) {
    case "set":
      return typeof value.field === "string";
    case "insert":
    case "delete":
      return isObject(value.values) && (value.cells === undefined || isObject(value.cells));
    case "page":
      return textOrAbsent(value.from) && textOrAbsent(value.to);
    case "formula":
      return typeof value.field === "string" && textOrAbsent(value.from) && textOrAbsent(value.to);
    default:
      return false;
  }
}

export interface EditLog {
  /** The events read, in the order written. */
  events: EditEvent[];
  /** Lines left out: ones that don't parse, and events of a kind this reader doesn't know. */
  skipped: number;
}

/**
 * `history.ndjson` read. A missing file is an empty history (pass ""
 * or nothing). A line that can't be parsed and an event whose `op` isn't
 * known are skipped and counted, never an error: the table doesn't
 * depend on this file (SPEC section 14, tolerant readers). An event met
 * twice (two copies merged) is kept once, by its id.
 */
export function parseEditLog(text: string | null | undefined): EditLog {
  const events: EditEvent[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const line of (text ?? "").split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (!readable(value)) {
      skipped++;
      continue;
    }
    if (seen.has(value.id)) continue;
    seen.add(value.id);
    events.push(value);
  }
  return { events, skipped };
}
