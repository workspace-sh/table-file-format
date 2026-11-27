// A view of a table the engine holds (table-file-format#867, step 2), as a ViewRows: what
// indexedViewRows gives for a table in the SQLite index, from the engine instead. The engine
// answers only what it can promise is what memory gives (applyView, searchRows, memoryViewRows),
// and otherwise says it can't (null), for the caller to work the view out in memory.

import { call, callBytes, callWindow } from "./engine.js";
import { rowsOf } from "./engineRows.js";
import type { IndexQuery } from "./indexer.js";
import type { RowGroup, ViewRows } from "./row-source.js";
import { enumValues, type ParsedTable, type Row } from "./types.js";
import { problemOf, type Found, type Problem, type ProblemCode, type ProblemContext } from "./problems.js";

/** A table the engine holds: its handle, and the fields its rows were read with (the columns it keeps). */
export interface HeldRows {
  handle: number;
  fields: readonly string[];
}

/** Rows held by the engine, given as objects: written as NDJSON and read in, as their file would be. */
export function holdRows(fields: readonly string[], rows: readonly Row[]): HeldRows {
  const handle = call<number>("rows.new", { fields });
  const text = rows.map((r) => JSON.stringify(r)).join("\n");
  callBytes("rows.read", { handle, file: "rows", stripBom: false }, new TextEncoder().encode(text));
  return { handle, fields };
}

/** Lets the engine drop a held table. */
export function freeRows(held: HeldRows): void {
  call("rows.free", { handle: held.handle });
}

type Answer = { view: number; count: number; inView: number; groups: RowGroup[]; totals: Record<string, number | null> };

/**
 * The rows a view of a held table shows, or null when the engine can't promise memory's answer:
 * a table with formulas (their results aren't held), or a view it can't answer (engine's view.rs).
 * `version` names the answer, as indexedViewRows' does.
 */
export function heldViewRows(held: HeldRows, table: Pick<ParsedTable, "schema" | "bodies" | "cells">, query: IndexQuery, version = ""): ViewRows | null {
  if (table.schema.fields.some((f) => f.computed) || (table.cells?.some((c) => c.expr !== undefined) ?? false)) return null;
  // A filter's list holding undefined: JSON can't carry it (it would cross as null, another value).
  if (query.filter?.some((f) => Array.isArray(f.value) && (f.value as unknown[]).includes(undefined))) return null;
  const input = {
    handle: held.handle,
    fields: table.schema.fields.map((f) => ({ name: f.name, type: f.type, choices: enumValues(f) })),
    query,
    ...(query.search?.trim() && table.bodies ? { bodies: table.bodies } : {}),
  };
  const ask = () => call<Answer | null>("rows.query", input);
  let answer = ask();
  if (!answer) return null;
  const first = answer;
  // The engine keeps a table's latest views; one asked for after it's gone is worked out again.
  const withView = <T>(use: (view: number) => T): T => {
    try {
      return use(answer!.view);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes("no view")) throw e;
      answer = ask()!;
      return use(answer.view);
    }
  };
  const range = (start: number, end: number) => {
    const from = Math.max(0, start);
    return { from, to: Math.max(from, end) };
  };
  const rows = (start: number, end: number): Row[] => {
    const { from, to } = range(start, end);
    if (to <= from) return [];
    const out: Row[] = [];
    withView((view) => rowsOf(callWindow("rows.window", { handle: held.handle, view, from, to }), held.fields, out));
    return out;
  };
  const placeOf = (id: string): number => withView((view) => call<number>("rows.place", { handle: held.handle, view, id }));
  const totals = Object.fromEntries(Object.entries(first.totals).map(([field, n]) => [field, n ?? undefined]));
  return {
    count: first.count,
    inView: first.inView,
    version: `held:${held.handle}|${version}|${JSON.stringify(query)}`,
    rows,
    ids: (start, end) => {
      const { from, to } = range(start, end);
      return to <= from ? [] : withView((view) => call<string[]>("rows.ids", { handle: held.handle, view, from, to }));
    },
    placeOf,
    row: (id) => {
      const at = placeOf(id);
      return at < 0 ? undefined : rows(at, at + 1)[0];
    },
    totals: () => totals,
    groups: () => first.groups,
  };
}

/** A held table's problems: how many of each kind, said at once, and any window of them made into Problems. */
export interface HeldProblems {
  total: number;
  counts: Partial<Record<ProblemCode, number>>;
  /** Problems `from` up to `to`, in problemsOf's order, with their words and fixes. */
  problems(from: number, to: number): Problem[];
}

/**
 * A held table's problems from its rows, pages and optional warnings: what problemsOf gives of them
 * (foundInRows), the engine finding them and this side saying them (problemOf), for a window at a
 * time. Null when the engine can't promise memory's answer: a table whose cells have their own
 * formulas, or a field with a `pattern` (a JavaScript RegExp). `heldTargets` names the tables
 * related ones are held as; a relation's target in memory gives its ids.
 */
export function heldProblems(
  held: HeldRows,
  table: Pick<ParsedTable, "schema" | "bodies" | "cells">,
  name: string,
  context: ProblemContext & { heldTargets?: Record<string, HeldRows> } = {},
): HeldProblems | null {
  if (table.cells?.some((c) => c.expr !== undefined)) return null;
  const targets: Record<string, { handle: number } | { ids: string[] }> = {};
  for (const f of table.schema.fields) {
    if (!f.relation) continue;
    const there = context.heldTargets?.[f.relation.table];
    const target = context.bundle?.tables[f.relation.table];
    if (there) targets[f.name] = { handle: there.handle };
    else if (target && target.indexed === undefined && target.loading === undefined) targets[f.name] = { ids: target.rows.map((r) => r.id) };
  }
  const input = {
    handle: held.handle,
    schema: { ...table.schema, fields: table.schema.fields.map((f) => ({ ...f, choices: enumValues(f) })) },
    bodies: table.bodies ? Object.keys(table.bodies) : [],
    attachments: context.attachments ?? null,
    targets,
  };
  type Answer = { total: number; counts: Partial<Record<ProblemCode, number>>; found: Found[] };
  // Counted first, with no problem made and no row read.
  const first = call<Answer | null>("rows.problems", { ...input, from: 0, to: 0 });
  if (!first) return null;
  return {
    total: first.total,
    counts: first.counts,
    problems(from, to) {
      const { found } = call<Answer>("rows.problems", { ...input, from: Math.max(0, from), to: Math.max(0, to) });
      // The rows their fixes read, and only those.
      const ids = [...new Set(found.map((f) => f.row).filter((id): id is string => id !== undefined))];
      const rows: Row[] = [];
      if (ids.length > 0) rowsOf(callWindow("rows.window", { handle: held.handle, ids }), held.fields, rows);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return found.map((f) => problemOf(f, table, name, (id) => byId.get(id)));
    },
  };
}
