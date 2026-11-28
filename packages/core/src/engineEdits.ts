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
  /**
   * The rows the changes changed, moved, added or took away. A row the batch names is here when its
   * place moved, even only because another went in before it.
   */
  changed: string[];
  /** The edits, as history says them (`rowsChanges`), each table-core's EditChange. */
  events: EditChange[];
  /** The table's pages and cells' own formulas after the changes: the same objects when they didn't change. */
  bodies: ParsedTable["bodies"];
  cells: ParsedTable["cells"];
  /** With `problems` asked: the problems the changes made and ended. */
  problems?: ProblemsChanged;
  /** What there is to undo and redo now. */
  steps: UndoDepth;
  /** The step this made or joined (or undid, or redid), by token: what the app's own step names. Null when it kept none. */
  step: number | null;
  /** An undo or redo a later edit made moot: the step it dropped, by token. */
  moot?: number;
}

/**
 * A held table's rows changed, as `applyChanges` changes rows in memory. A `set` of a row's `id`
 * is refused, where applyChanges would rename the row (diffBundle never makes one): a caller with
 * such a batch applies it in memory instead. `table` is the held
 * table's schema, pages and cells as they are before. `problems`: what `rows.problems` is asked
 * (`heldProblems`' input), to be told the problems that changed. Throws, having changed nothing,
 * when the engine can't take a change (one that isn't a row's).
 */
export function applyToHeld(
  held: HeldRows,
  table: Pick<ParsedTable, "schema" | "bodies" | "cells">,
  changes: readonly RowChange[],
  options: {
    problems?: object;
    /** One batch given in runs (its changes to fields and views made between): the same name for each, so a row one run takes out a later one can bring back. */
    batch?: string;
    /** A stretch of the same edit (a page typed in): kept with the step before it of the same name, undone as one. */
    run?: string;
    /** How many edits to keep to undo, oldest dropped first. The app's own budget; left out, the app drops steps itself (`dropSteps`). */
    keep?: number;
    /** False: not kept to undo (an edit that isn't the person's, such as a refresh). */
    undoable?: boolean;
  } = {},
): HeldApplied {
  return applied(
    "rows.apply",
    held,
    table,
    new Set(changes.map((c) => c.row)),
    {
      changes,
      ...(options.run !== undefined ? { run: options.run } : {}),
      ...(options.keep !== undefined ? { keep: options.keep } : {}),
      ...(options.undoable === false ? { undoable: false } : {}),
      ...(options.batch !== undefined ? { batch: options.batch } : {}),
    },
    options.problems,
  );
}

/** How many edits a held table has to undo and to redo, the bytes kept for them, and the tokens of the steps on top. */
export interface UndoDepth {
  undo: number;
  redo: number;
  bytes: number;
  nextUndo: number | null;
  nextRedo: number | null;
}

/**
 * A held table's last edit undone (or, `redo`, the last undone edit made again), exactly: each row
 * as it was, byte for byte and in its place, with its page and its cells' own formulas. Null when
 * there's nothing to undo. The answer is as `applyToHeld`'s, and the step goes to the other stack.
 *
 * `step`: the token of the step the app's own undo expects (its stack is the one order); another
 * on top throws. A step a later edit made moot changes nothing and is dropped (`moot` says which):
 * with `step` given that's the answer; without, the next step is undone instead.
 */
export function undoHeld(held: HeldRows, table: Pick<ParsedTable, "schema" | "bodies" | "cells">, options: { redo?: boolean; step?: number; problems?: object } = {}): HeldApplied | null {
  for (;;) {
    const named = new Set(call<string[]>("rows.undoNames", { handle: held.handle, redo: options.redo ?? false }));
    if (named.size === 0) return null;
    const done = applied(options.redo ? "rows.redo" : "rows.undo", held, table, named, options.step !== undefined ? { step: options.step } : {}, options.problems);
    if (done.moot === undefined || options.step !== undefined) return done;
  }
}

/** Steps the app's budget let go, by token: their inverses go. */
export function dropSteps(held: HeldRows, steps: readonly number[]): number {
  return call<number>("rows.dropSteps", { handle: held.handle, steps });
}

/** How many edits there are to undo and to redo. */
export function undoDepth(held: HeldRows): UndoDepth {
  return call<UndoDepth>("rows.undoDepth", { handle: held.handle });
}

/** A batch through the engine (`op`): the rows it names given their pages and cells, and those changed as it says. */
function applied(op: string, held: HeldRows, table: Pick<ParsedTable, "schema" | "bodies" | "cells">, named: ReadonlySet<string>, input: object, problems?: object): HeldApplied {
  const pages: Record<string, string> = {};
  for (const id of named) if (table.bodies && Object.hasOwn(table.bodies, id)) pages[id] = table.bodies[id]!;
  const answer = call<{ changed: string[]; events: EditChange[]; effects: Effect[]; problems?: ProblemsChanged; steps: UndoDepth; step: number | null; moot?: number } | null>(op, {
    handle: held.handle,
    ...input,
    computed: table.schema.fields.filter((f) => f.computed).map((f) => f.name),
    pages,
    cells: (table.cells ?? []).filter((c) => named.has(c.id)),
    ...(problems ? { problems } : {}),
  });
  if (answer === null) return { changed: [], events: [], bodies: table.bodies, cells: table.cells, steps: undoDepth(held), step: null };
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
  return {
    changed: answer.changed,
    events: answer.events,
    bodies,
    cells,
    steps: answer.steps,
    step: answer.step,
    ...(answer.moot !== undefined ? { moot: answer.moot } : {}),
    ...(answer.problems ? { problems: answer.problems } : {}),
  };
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
 * before). The changes go in the order given, a run at a time: a run of rows' changes to the
 * engine, a run of the others here, since a change to a field or a table can change what a row's
 * change does after it. Without an engine, applyChanges itself.
 */
export function applyChangesThroughEngine(bundle: ParsedBundle, changes: readonly BundleChange[]): ParsedBundle {
  if (!formulaEngineSet()) return applyChanges(bundle, changes);
  // Each table held once for the whole batch, so a row one run takes out a later run can bring
  // back, as applyChanges brings it back (the engine carries them by the batch's name).
  const batch = `batch:${++batches}`;
  const held = new Map<string, HeldRows>();
  let out = bundle;
  try {
    let at = 0;
    while (at < changes.length) {
      const rows = isRowChange(changes[at]!);
      let end = at;
      while (end < changes.length && isRowChange(changes[end]!) === rows) end++;
      const run = changes.slice(at, end);
      if (rows) out = rowsThroughEngine(out, run as RowChange[], held, batch);
      else {
        // A table taken away, or added again whole: what the engine held of it is no one's.
        for (const c of run) {
          if (c.op !== "table-remove" && c.op !== "table-add") continue;
          const h = held.get(c.table);
          if (h) {
            freeRows(h);
            held.delete(c.table);
          }
        }
        out = applyChanges(out, run);
      }
      at = end;
    }
    // The rows each table holds now, read once.
    if (held.size > 0) {
      out = { ...out, tables: { ...out.tables } };
      for (const [name, h] of held) if (out.tables[name]) out.tables[name] = { ...out.tables[name]!, rows: heldRowsAll(h) };
    }
    return out;
  } finally {
    for (const h of held.values()) freeRows(h);
  }
}

/** Batches through the engine so far, to name each. */
let batches = 0;

/** A run of rows' changes applied by the engine to the tables it holds for the batch (held as first met). */
function rowsThroughEngine(bundle: ParsedBundle, changes: readonly RowChange[], held: Map<string, HeldRows>, batch: string): ParsedBundle {
  const byTable = new Map<string, RowChange[]>();
  for (const c of changes) {
    if (!byTable.has(c.table)) byTable.set(c.table, []);
    byTable.get(c.table)!.push(c);
  }
  const out: ParsedBundle = { ...bundle, tables: { ...bundle.tables } };
  for (const [name, rowChanges] of byTable) {
    const table = out.tables[name];
    if (!table) continue;
    if (table.indexed || table.loading) throw new RowsNotLoadedError(name);
    let h = held.get(name);
    if (!h) {
      h = holdRows(
        table.schema.fields.map((f) => f.name),
        table.rows,
      );
      held.set(name, h);
    }
    // One step to undo for the whole batch: its runs share a run.
    const applied = applyToHeld(h, table, rowChanges, { batch, run: batch });
    out.tables[name] = {
      ...table,
      ...(applied.bodies ? { bodies: applied.bodies } : {}),
      ...(applied.cells ? { cells: applied.cells } : {}),
    };
  }
  return out;
}
