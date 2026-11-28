// Edits to a table the engine holds (table-file-format#867, step 3a): the changes `changes.ts`
// defines, applied by the engine to its rows as `applyChanges` applies them to rows in memory,
// the merge rule and all. A row's page and its cells' own formulas stay here: the engine is given
// those of the rows the changes name, and says what to do to them, in applyChanges' order.
// It answers too with the rows that changed and the edits as history says them (`rowsChanges`).
//
// Only rows' changes go to the engine: a change to a table's fields, schema, views or meta, or a
// table added or removed, is applied here, as now (`isRowChange` tells them apart).

import { applyChanges, RowsNotLoadedError, type BundleChange } from "./changes.js";
import type { EditChange } from "./edit-log.js";
import { call, callWindow, formulaEngineSet } from "./engine.js";
import { rowsOf } from "./engineRows.js";
import { freeRows, holdRows, type HeldRows } from "./engineViews.js";
import type { Found } from "./problems.js";
import type { CellFormula, ParsedBundle, ParsedTable, Row } from "./types.js";

/** The changes the engine applies: a row's. */
export type RowChange = Extract<BundleChange, { op: "set" | "insert" | "delete" | "move" | "page" | "cell" }>;

const ROW_OPS: ReadonlySet<BundleChange["op"]> = new Set(["set", "insert", "delete", "move", "page", "cell"]);

export const isRowChange = (c: BundleChange): c is RowChange => ROW_OPS.has(c.op);

/** What to do to the pages and cells kept here, in order. */
type Effect = { op: "page"; row: string; to?: string } | { op: "cells-drop"; row: string; field?: string } | { op: "cells-add"; cells: CellFormula[] };

/** The problems an edit made and the ones it ended, as `rows.problems` says them, and how many there are now. */
export interface ProblemsChanged {
  total: number;
  counts: Record<string, number>;
  found: Found[];
  gone: Found[];
}

/** A held table after changes. */
export interface HeldApplied {
  /** The rows the changes changed, moved, added or took away. */
  changed: string[];
  /** The edits, as history says them (`rowsChanges`), each table-core's EditChange. */
  events: EditChange[];
  /** The table's pages and cells' own formulas after the changes: the same objects when they didn't change. */
  bodies: ParsedTable["bodies"];
  cells: ParsedTable["cells"];
  /** With `problems` asked: the problems the changes made and ended. */
  problems?: ProblemsChanged;
}

/**
 * A held table's rows changed, as `applyChanges` changes rows in memory. `table` is the held
 * table's schema, pages and cells as they are before. `problems`: what `rows.problems` is asked
 * (`heldProblems`' input), to be told the problems that changed. Throws, having changed nothing,
 * when the engine can't take a change (one that isn't a row's).
 */
export function applyToHeld(held: HeldRows, table: Pick<ParsedTable, "schema" | "bodies" | "cells">, changes: readonly RowChange[], options: { problems?: object } = {}): HeldApplied {
  const named = new Set(changes.map((c) => c.row));
  const pages: Record<string, string> = {};
  for (const id of named) if (table.bodies && Object.hasOwn(table.bodies, id)) pages[id] = table.bodies[id]!;
  const answer = call<{ changed: string[]; events: EditChange[]; effects: Effect[]; problems?: ProblemsChanged }>("rows.apply", {
    handle: held.handle,
    changes,
    computed: table.schema.fields.filter((f) => f.computed).map((f) => f.name),
    pages,
    cells: (table.cells ?? []).filter((c) => named.has(c.id)),
    ...(options.problems ? { problems: options.problems } : {}),
  });
  let bodies = table.bodies;
  let cells = table.cells;
  let ownBodies = false;
  for (const e of answer.effects) {
    if (e.op === "page") {
      if (!ownBodies) (bodies = { ...bodies }), (ownBodies = true);
      if (e.to === undefined) delete bodies![e.row];
      else bodies![e.row] = e.to;
    } else if (e.op === "cells-drop") {
      cells = (cells ?? []).filter((c) => !(c.id === e.row && (e.field === undefined || c.field === e.field)));
    } else {
      cells = [...(cells ?? []), ...e.cells];
    }
  }
  return { changed: answer.changed, events: answer.events, bodies, cells, ...(answer.problems ? { problems: answer.problems } : {}) };
}

/** A held table's rows, all of them, in order. */
export function heldRowsAll(held: HeldRows): Row[] {
  const count = call<number>("rows.count", { handle: held.handle });
  const rows: Row[] = [];
  for (let from = 0; from < count; from += 50_000) rowsOf(callWindow("rows.window", { handle: held.handle, from, to: Math.min(count, from + 50_000) }), held.fields, rows);
  return rows;
}

/**
 * `applyChanges` with each table's rows' changes applied by the engine: the bundle the same
 * changes give in memory (rows made again from the engine's, so none is the same object as
 * before). Without an engine, applyChanges itself.
 */
export function applyChangesThroughEngine(bundle: ParsedBundle, changes: readonly BundleChange[]): ParsedBundle {
  if (!formulaEngineSet()) return applyChanges(bundle, changes);
  const byTable = new Map<string, RowChange[]>();
  for (const c of changes) {
    if (!isRowChange(c)) continue;
    if (!byTable.has(c.table)) byTable.set(c.table, []);
    byTable.get(c.table)!.push(c);
  }
  const out = applyChanges(
    bundle,
    changes.filter((c) => !isRowChange(c)),
  );
  for (const [name, rowChanges] of byTable) {
    const table = out.tables[name];
    if (!table) continue;
    if (table.indexed || table.loading) throw new RowsNotLoadedError(name);
    const held = holdRows(
      table.schema.fields.map((f) => f.name),
      table.rows,
    );
    try {
      const applied = applyToHeld(held, table, rowChanges);
      out.tables[name] = {
        ...table,
        rows: heldRowsAll(held),
        ...(applied.bodies ? { bodies: applied.bodies } : {}),
        ...(applied.cells ? { cells: applied.cells } : {}),
      };
    } finally {
      freeRows(held);
    }
  }
  return out;
}
