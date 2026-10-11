/**
 * Native (iOS, Android, macOS): a table's rows, drawn only where they're on
 * screen (LARGE-TABLES-PLAN, I1), in a page that says where it is scrolled
 * (PageScrollContext). Without one, every row is drawn, as before.
 *
 * The list scrolls with the page, as the web's does: the screen's own
 * scroll view stays the scroller, so what's above the table scrolls with
 * it and the screen keeps its insets and its large title. The list is a
 * body as tall as all its rows, with the rows on screen placed in it by
 * their known heights; nothing is measured, and nothing needs a list
 * library to recycle it. A table's two panes (the frozen first column,
 * and the rest) are two such lists hearing the same page, with the same
 * items and heights, so they show the same rows side by side.
 *
 * This is the web's list (RowList.web.tsx), which follows the page's
 * scroller the same way, and its reasoning is kept here.
 */
import { Fragment, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { PageScrollContext, type PageScroll } from "../pageScroll";
import { MAX_LIST_HEIGHT } from "./listLimits";
import type { RowListProps } from "./RowList";

export type { RowListHandle, RowListProps } from "./RowList";

/** How far past the screen rows are kept drawn, in points. */
const DRAW_DISTANCE = 600;
/**
 * Where the list starts in the page is asked again when the page can't say
 * (it isn't laid out yet), or doesn't answer at all: after each of these
 * waits, in milliseconds. The rows don't wait for it.
 */
const MEASURE_AGAIN_MS = [50, 300, 1000, 3000];
/** How long the page is given to answer before it's asked again. */
const MEASURE_WAIT_MS = 250;

export function RowList<T>(props: RowListProps<T>) {
  const page = useContext(PageScrollContext);
  return page ? <WindowedRows {...props} page={page} /> : <EveryRow {...props} />;
}

/** Every row drawn: a page that doesn't say where it is scrolled. */
function EveryRow<T>({ items, keyOf, render, handle, onShown }: RowListProps<T>) {
  useImperativeHandle(handle, () => ({ scrollIndexIntoView: () => {}, top: () => null }), []);
  useEffect(() => {
    if (items.length > 0) onShown?.(0, items.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={keyOf(item)}>{render(item, i)}</Fragment>
      ))}
    </>
  );
}

/** Where each item is: what the list needs of a RowLayout. */
interface Tops {
  count: number;
  height: number;
  /** An item's top, with any room above it (a group's heading) in the item. */
  itemTop(index: number): number;
  /** The item at `y`: the first whose bottom is past it. `count` when `y` is past them all. */
  at(y: number): number;
}

/** The items' tops from their heights, added up once: for a list that isn't given its layout. */
function topsOf<T>(items: readonly T[], sizeOf: (item: T, index: number) => number): Tops {
  const count = items.length;
  const tops = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) tops[i + 1] = tops[i]! + sizeOf(items[i]!, i);
  return {
    count,
    height: tops[count]!,
    itemTop: (index) => tops[Math.max(0, Math.min(count, index))]!,
    at: (y) => {
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tops[mid + 1]! <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}

/** The last move a list made of a page to settle it, for the lists beside it. */
const settles = new WeakMap<object, { to: number; shift: number; when: number }>();

/**
 * The rows on screen, placed in a body as tall as the list, or as tall as
 * MAX_LIST_HEIGHT when the list is taller than can be laid out exactly
 * (a million rows is some 45 million points, past what a 32-bit layout
 * places to the point); the page's scrolling is then mapped onto the whole
 * list.
 *
 * `shift` is how far the rows are from where the page is: the row at the
 * page's place plus `shift` is the one at the top of the screen. Scrolling
 * moves the rows a point a point, with the shift as it is. A jump (far in
 * one move) sets it by how far down the page is, so the page's whole
 * travel is the whole list. Two lists side by side hear the same scrolling
 * and so keep the same shift.
 */
function WindowedRows<T>({
  items,
  keyOf,
  sizeOf,
  render,
  version,
  raised,
  handle,
  onShown,
  layout: layoutOf,
  page,
}: RowListProps<T> & { page: PageScroll }) {
  const body = useRef<View | null>(null);
  // Given its layout, the list asks it; otherwise the heights are added up
  // once for these items (`version` changes when a height could have).
  const given = layoutOf !== undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const added = useMemo(() => (given ? null : topsOf(items, sizeOf)), [given, items, version]);
  const layout: Tops = layoutOf ? layoutOf() : added!;
  const laidOut = Math.min(layout.height, MAX_LIST_HEIGHT);
  const extra = layout.height - laidOut;
  // What is drawn: a stretch of the list, in its own points, and the shift it is drawn at.
  const [drawn, setDrawn] = useState({ from: 0, to: 3 * DRAW_DISTANCE, shift: 0 });
  // The body's top within what the page scrolls; null until it's measured,
  // and taken as the page's own top meanwhile: the rows are drawn from the
  // first, which is right for a list that starts on the first screen, and
  // put right as soon as the page says where the list is.
  const top = useRef<number | null>(null);
  // Where the page was when last looked at; `jump` and `settled` are moves this list made itself.
  const last = useRef<{ at: number | null; jump: boolean; settled: number | null }>({ at: null, jump: false, settled: null });
  const now = useRef({ laidOut, extra, layout });
  now.current = { laidOut, extra, layout };
  const drawnShift = useRef(0);
  drawnShift.current = drawn.shift;

  /** How far the page is scrolled past the list's top, and how much of the list it shows. */
  const where = useCallback(() => {
    const { offset, height } = page.now();
    return { at: offset - (top.current ?? 0), page: height };
  }, [page]);

  const follow = useCallback(() => {
    const { at, page: screen } = where();
    if (screen <= 0) return;
    const { laidOut: height, extra: more } = now.current;
    const range = Math.max(1, height - screen);
    // The first look is where the page already was, not a jump to it: a list
    // that has just become this tall (rows still arriving) keeps its place.
    const jumped = last.current.jump || (last.current.at !== null && Math.abs(at - last.current.at) > 3 * screen);
    const atAnEnd = at <= 0 || at >= range - 0.5;
    const settled = last.current.settled;
    last.current = { at, jump: false, settled: null };
    setDrawn((was) => {
      const shift =
        more <= 0 ? 0 : settled !== null ? settled : jumped || atAnEnd ? more * Math.min(1, Math.max(0, at / range)) : Math.min(was.shift, more);
      const start = at + shift;
      return shift === was.shift && start - DRAW_DISTANCE / 2 >= was.from && start + screen + DRAW_DISTANCE / 2 <= was.to
        ? was
        : { from: start - DRAW_DISTANCE, to: start + screen + DRAW_DISTANCE, shift };
    });
  }, [where]);

  // Once scrolling rests, the page is put where the rows on screen are in the
  // whole list, with the rows left where they are: how far down the page is
  // then says how far down the table you are, and scrolling on never runs
  // out of body short of the table's end.
  const settle = useCallback(() => {
    if (top.current === null) return;
    const { at, page: screen } = where();
    const { laidOut: height, extra: more } = now.current;
    if (more <= 0) return;
    const range = Math.max(1, height - screen);
    // Two lists side by side follow one page: the first to rest moves it, and
    // the other takes the same shift, not a second move.
    const moved = settles.get(page);
    if (moved && Date.now() - moved.when < 100 && Math.abs(at - moved.to) < 1) {
      last.current.settled = moved.shift;
      follow();
      return;
    }
    const start = at + drawnShift.current;
    const to = Math.min(range, Math.max(0, start / (1 + more / range)));
    if (Math.abs(to - at) < 2) return;
    last.current.settled = start - to;
    settles.set(page, { to, shift: start - to, when: Date.now() });
    page.scrollBy(to - at);
  }, [page, where, follow]);

  // Where the list starts in the page: measured as it's laid out, and again
  // when the page or what's in it changes size (something above the list
  // may have changed height).
  // Each asking replaces the one before; an answer to an old one is dropped.
  const asking = useRef<{ n: number; again: ReturnType<typeof setTimeout> | null }>({ n: 0, again: null });
  const measure = useCallback(() => {
    const ask = asking.current;
    const n = ++ask.n;
    if (ask.again) clearTimeout(ask.again);
    const tryAt = (attempt: number) => {
      let answered = false;
      const later = () => {
        if (ask.n !== n || attempt >= MEASURE_AGAIN_MS.length) return;
        if (ask.again) clearTimeout(ask.again);
        ask.again = setTimeout(() => tryAt(attempt + 1), MEASURE_AGAIN_MS[attempt]);
      };
      // A page that never answers is asked again as one that couldn't say.
      const waited = setTimeout(() => {
        if (!answered) later();
      }, MEASURE_WAIT_MS);
      void page.topOf(body.current).then((measured) => {
        answered = true;
        clearTimeout(waited);
        if (ask.n !== n) return;
        if (measured === null || !Number.isFinite(measured)) return later();
        if (ask.again) clearTimeout(ask.again);
        ask.again = null;
        top.current = measured;
        follow();
      });
    };
    tryAt(0);
  }, [page, follow]);
  useEffect(
    () => () => {
      asking.current.n++;
      if (asking.current.again) clearTimeout(asking.current.again);
    },
    [],
  );

  useEffect(() => {
    let rest: ReturnType<typeof setTimeout> | null = null;
    const stop = page.subscribe((what) => {
      if (what === "resize") return measure();
      if (rest) clearTimeout(rest);
      rest = setTimeout(settle, 160);
      follow();
    });
    return () => {
      if (rest) clearTimeout(rest);
      stop();
    };
  }, [page, follow, settle, measure]);
  // A list that has changed (rows added, a height changed) is looked at again.
  useEffect(() => follow(), [follow, layout.count, layout.height]);

  const count = items.length;
  const first = count ? Math.min(layout.at(drawn.from), count - 1) : 0;
  const lastDrawn = count ? Math.min(layout.at(drawn.to), count - 1) : -1;

  const latestOnShown = useRef(onShown);
  latestOnShown.current = onShown;
  useEffect(() => {
    if (lastDrawn >= first) latestOnShown.current?.(first, lastDrawn);
  }, [first, lastDrawn]);

  useImperativeHandle(
    handle,
    () => ({
      scrollIndexIntoView: (index: number) => {
        if (top.current === null) return;
        const { at, page: screen } = where();
        const { laidOut: height, extra: more, layout: l } = now.current;
        const range = Math.max(1, height - screen);
        const itemTop = l.itemTop(index);
        const size = (index + 1 < l.count ? l.itemTop(index + 1) : l.height) - itemTop;
        // Already wholly on screen: left where it is.
        const shown = itemTop - drawnShift.current;
        if (more <= 0 && shown >= at && shown + size <= at + screen) return;
        // Where the page would be with the item in the middle of the screen, were the list its full height.
        const wanted = Math.max(0, itemTop - (screen - size) / 2);
        const to = more <= 0 ? wanted : Math.min(range, wanted / (1 + more / range));
        last.current.jump = true;
        const by = to - at;
        page.scrollBy(by);
        // Nothing to scroll (already there): the shift is still set for it.
        if (Math.abs(by) < 0.5) follow();
      },
      // An item's own top is this plus where the layout puts it.
      top: () => (top.current === null ? null : page.windowTop() + top.current - drawnShift.current),
    }),
    [page, where, follow],
  );

  const rows: ReactNode[] = [];
  for (let i = first; i <= lastDrawn; i++) {
    const item = items[i]!;
    const itemTop = layout.itemTop(i);
    const height = (i + 1 < count ? layout.itemTop(i + 1) : layout.height) - itemTop;
    rows.push(
      <View
        key={keyOf(item)}
        style={{ position: "absolute", top: itemTop - drawn.shift, left: 0, right: 0, height, zIndex: raised?.(item) ? 1 : 0 }}
      >
        {render(item, i)}
      </View>,
    );
  }
  return (
    <View ref={body} onLayout={measure} style={{ height: laidOut }}>
      {rows}
    </View>
  );
}
