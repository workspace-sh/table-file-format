// A view's rows read from a ViewRows (table-core), for the lists that draw
// a window of them: the rows of the window, the view's groups and totals,
// and the places of the rows that have a height of their own. A source
// over memory answers at once and is read as the view draws. One over the
// index answers a little later: until it does, a row is `undefined` (drawn
// as an empty row of its height) and groups, totals and places are the
// last ones known, so a list never waits on its rows to scroll.

import type { Row, RowGroup, ViewRows } from "@workspace.sh/table-core";
import { useEffect, useMemo, useReducer, useRef } from "react";

/** Rows asked for at a time; LARGE-TABLES-PLAN's starting size. */
export const VIEW_PAGE = 200;

const answersAtOnce = new WeakMap<ViewRows, boolean>();
/** Whether a source's answers are values, not promises: an empty window says, and costs nothing. */
export function isImmediate(source: ViewRows): boolean {
  let known = answersAtOnce.get(source);
  if (known === undefined) answersAtOnce.set(source, (known = Array.isArray(source.rows(0, 0))));
  return known;
}

interface Pages {
  version: string;
  pages: Map<number, Row[]>;
  asked: Set<number>;
}

/**
 * The rows at places `start` up to `end`, in order: `undefined` where one
 * hasn't arrived. While a new snapshot's rows are on their way, the last
 * snapshot's are shown, never a mix of the two.
 */
export function useViewWindow(source: ViewRows, start: number, end: number): (Row | undefined)[] {
  const [, arrived] = useReducer((n: number) => n + 1, 0);
  const now = useRef<Pages>({ version: source.version, pages: new Map(), asked: new Set() });
  const shown = useRef<Pages | null>(null);
  const immediate = isImmediate(source);
  if (now.current.version !== source.version) now.current = { version: source.version, pages: new Map(), asked: new Set() };
  const from = Math.max(0, start);
  const to = Math.min(end, source.count);
  const first = Math.floor(from / VIEW_PAGE);
  const last = to > from ? Math.floor((to - 1) / VIEW_PAGE) : first - 1;

  useEffect(() => {
    if (immediate) return;
    const pages = now.current;
    for (let p = first; p <= last; p++) {
      if (pages.pages.has(p) || pages.asked.has(p)) continue;
      pages.asked.add(p);
      void Promise.resolve(source.rows(p * VIEW_PAGE, (p + 1) * VIEW_PAGE)).then(
        (rows) => {
          pages.pages.set(p, rows);
          if (now.current === pages) arrived();
        },
        () => {
          // Asked again the next time it's wanted.
          pages.asked.delete(p);
        },
      );
    }
    // Pages far from the window are let go.
    if (pages.pages.size > 24) {
      for (const p of [...pages.pages.keys()]) {
        if (p < first - 8 || p > last + 8) {
          pages.pages.delete(p);
          pages.asked.delete(p);
        }
      }
    }
  }, [source, immediate, first, last]);

  if (immediate) return to > from ? (source.rows(from, to) as Row[]) : [];
  // Pages the source already holds are taken as they are, with no wait.
  if (source.peek) {
    for (let p = first; p <= last; p++) {
      if (now.current.pages.has(p)) continue;
      const held = source.peek(p * VIEW_PAGE, (p + 1) * VIEW_PAGE);
      if (held) now.current.pages.set(p, held);
    }
  }
  let complete = true;
  for (let p = first; p <= last; p++) if (!now.current.pages.has(p)) complete = false;
  if (complete) shown.current = now.current;
  const read = shown.current ?? now.current;
  const out: (Row | undefined)[] = [];
  for (let i = from; i < to; i++) out.push(read.pages.get(Math.floor(i / VIEW_PAGE))?.[i % VIEW_PAGE]);
  return out;
}

export interface ViewFacts {
  groups: RowGroup[];
  totals: Record<string, number | undefined>;
  /** The place of each row asked about that the view shows. */
  places: Map<string, number>;
}

const NOTHING: ViewFacts = { groups: [], totals: {}, places: new Map() };

/** The view's groups and totals, and the places of the rows `ids` names (those with a height of their own). */
export function useViewFacts(source: ViewRows, ids: readonly string[]): ViewFacts {
  const [, arrived] = useReducer((n: number) => n + 1, 0);
  const known = useRef<{ key: string; facts: ViewFacts }>({ key: "", facts: NOTHING });
  const immediate = isImmediate(source);
  const key = `${source.version}\u0000${ids.join("\u0000")}`;
  const direct = useMemo(() => {
    if (!immediate) return null;
    const places = new Map<string, number>();
    for (const id of ids) {
      const place = source.placeOf(id) as number;
      if (place >= 0) places.set(id, place);
    }
    return { groups: source.groups() as RowGroup[], totals: source.totals() as Record<string, number | undefined>, places };
    // `key` stands for the source's snapshot and the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, key]);

  useEffect(() => {
    if (immediate || known.current.key === key) return;
    let current = true;
    void Promise.all([source.groups(), source.totals(), Promise.all(ids.map((id) => source.placeOf(id)))]).then(([groups, totals, at]) => {
      if (!current) return;
      const places = new Map<string, number>();
      ids.forEach((id, i) => at[i]! >= 0 && places.set(id, at[i]!));
      known.current = { key, facts: { groups, totals, places } };
      arrived();
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, key]);

  return direct ?? known.current.facts;
}
