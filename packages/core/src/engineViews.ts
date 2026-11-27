// A view of a table the engine holds (table-file-format#867, step 2), as a ViewRows: what
// indexedViewRows gives for a table in the SQLite index, from the engine instead. The engine
// answers only what it can promise is what memory gives (applyView, searchRows, memoryViewRows),
// and otherwise says it can't (null), for the caller to work the view out in memory.

import { call, callBytes, callWindow } from "./engine.js";
import { rowsOf } from "./engineRows.js";
import type { IndexQuery } from "./indexer.js";
import type { RowGroup, ViewRows } from "./row-source.js";
import { enumValues, type ParsedTable, type Row } from "./types.js";

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
