import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAX_LIST_HEIGHT } from "./listLimits";
import type { RowListProps } from "./RowList";

export type { RowListHandle, RowListProps } from "./RowList";

/** How far past the screen rows are kept drawn, in pixels. */
const DRAW_DISTANCE = 600;

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

/**
 * The nearest ancestor that really scrolls vertically, or null when the window
 * does.
 *
 * `overflow-y: auto` doesn't say an element scrolls: one with no height of its
 * own just grows with what's inside it, and the window scrolls instead (the
 * web demo's page area is like that). A list that followed such an element
 * would take all of its rows to be on screen and draw every one. So each
 * candidate is tried: with something very tall inside the list's place, an
 * element that scrolls stays its height, and one that only grows doesn't.
 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  if (el === null) return null;
  const probe = document.createElement("div");
  probe.style.height = "100000px";
  el.appendChild(probe);
  try {
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      const scrolls = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
      if (scrolls && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return null;
  } finally {
    probe.remove();
  }
}

/** The last move a list made of a page to settle it, for the lists beside it. */
const settles = new WeakMap<object, { to: number; shift: number; when: number }>();

/**
 * A table's rows, drawn only where they're on screen (LARGE-TABLES-PLAN, W1).
 *
 * The list scrolls with the page rather than in a box of its own: it follows
 * the nearest scrolling ancestor, so the header above it and the bands below
 * scroll with it. A table's two panes (the frozen first column, and the
 * rest) are two lists following that same scroller, with the same items and
 * heights, so they always show the same rows side by side.
 *
 * The list is a body as tall as all its rows, with the rows on screen placed
 * in it by their known heights: nothing is measured. A list taller than a
 * browser lays out (it stops placing things some millions of pixels down)
 * has a body of MAX_LIST_HEIGHT, and the page's scrolling is mapped onto the
 * whole list.
 *
 * `shift` is how far the rows are from where the page is: the row at the
 * page's place plus `shift` is the one at the top of the screen. Scrolling
 * moves the rows a pixel a pixel, with the shift as it is. A jump (the
 * scrollbar dragged, a key that goes far) sets it by how far down the page
 * is, so the bar's whole travel is the whole list. Two lists side by side
 * hear the same scrolling and so keep the same shift.
 */
export function RowList<T>({ items, keyOf, sizeOf, render, version, raised, handle, onShown, layout: layoutOf }: RowListProps<T>) {
  const anchor = useRef<HTMLDivElement | null>(null);
  // Given its layout, the list asks it; otherwise the heights are added up
  // once for these items (`version` changes when a height could have).
  const given = layoutOf !== undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const added = useMemo(() => (given ? null : topsOf(items, sizeOf)), [given, items, version]);
  const layout: Tops = layoutOf ? layoutOf() : added!;
  const laidOut = Math.min(layout.height, MAX_LIST_HEIGHT);
  const extra = layout.height - laidOut;
  const [scroller, setScroller] = useState<HTMLElement | null | undefined>(undefined);
  // What is drawn: a stretch of the list, in its own pixels, and the shift it is drawn at.
  const [drawn, setDrawn] = useState({ from: 0, to: 3 * DRAW_DISTANCE, shift: 0 });
  // Where the page was when last looked at; `jump` and `settled` are moves this list made itself.
  const last = useRef<{ at: number | null; jump: boolean; settled: number | null }>({ at: null, jump: false, settled: null });
  const now = useRef({ laidOut, extra, layout });
  now.current = { laidOut, extra, layout };
  const drawnShift = useRef(0);
  drawnShift.current = drawn.shift;

  useLayoutEffect(() => {
    setScroller(scrollParent(anchor.current));
  }, []);

  /** How far the page is scrolled past the list's top, and how much of the list it shows. */
  const where = useCallback(() => {
    const top = anchor.current?.getBoundingClientRect().top ?? 0;
    const page = scroller ? scroller.clientHeight : window.innerHeight;
    const pageTop = scroller ? scroller.getBoundingClientRect().top : 0;
    return { at: pageTop - top, page };
  }, [scroller]);

  const follow = useCallback(() => {
    const { at, page } = where();
    const { laidOut: height, extra: more } = now.current;
    const range = Math.max(1, height - page);
    // The first look is where the page already was, not a jump to it: a list
    // that has just become this tall (rows still arriving) keeps its place.
    const jumped = last.current.jump || (last.current.at !== null && Math.abs(at - last.current.at) > 3 * page);
    const atAnEnd = at <= 0 || at >= range - 0.5;
    const settled = last.current.settled;
    last.current = { at, jump: false, settled: null };
    setDrawn((was) => {
      const shift =
        more <= 0 ? 0 : settled !== null ? settled : jumped || atAnEnd ? more * Math.min(1, Math.max(0, at / range)) : Math.min(was.shift, more);
      const top = at + shift;
      return shift === was.shift && top - DRAW_DISTANCE / 2 >= was.from && top + page + DRAW_DISTANCE / 2 <= was.to
        ? was
        : { from: top - DRAW_DISTANCE, to: top + page + DRAW_DISTANCE, shift };
    });
  }, [where]);

  // Once scrolling rests, the page is put where the rows on screen are in the
  // whole list, with the rows left where they are: the scrollbar then says
  // how far down the table you are, and scrolling on never runs out of body
  // short of the table's end.
  const settle = useCallback(() => {
    const { at, page } = where();
    const { laidOut: height, extra: more } = now.current;
    if (more <= 0) return;
    const range = Math.max(1, height - page);
    // Two lists side by side follow one page: the first to rest moves it, and
    // the other takes the same shift, not a second move.
    const page_ = scroller ?? window;
    const moved = settles.get(page_);
    if (moved && performance.now() - moved.when < 100 && Math.abs(at - moved.to) < 1) {
      last.current.settled = moved.shift;
      follow();
      return;
    }
    const top = at + drawnShift.current;
    const to = Math.min(range, Math.max(0, top / (1 + more / range)));
    if (Math.abs(to - at) < 2) return;
    last.current.settled = top - to;
    settles.set(page_, { to, shift: top - to, when: performance.now() });
    if (scroller) scroller.scrollTop += to - at;
    else window.scrollBy({ top: to - at });
  }, [scroller, where, follow]);

  useEffect(() => {
    if (scroller === undefined) return;
    const target: HTMLElement | Window = scroller ?? window;
    let due = false;
    let rest: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (rest) clearTimeout(rest);
      rest = setTimeout(settle, 160);
      if (due) return;
      due = true;
      requestAnimationFrame(() => {
        due = false;
        follow();
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    follow();
    return () => {
      if (rest) clearTimeout(rest);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scroller, follow, settle]);

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
        const { at, page } = where();
        const { laidOut: height, extra: more, layout: l } = now.current;
        const range = Math.max(1, height - page);
        const top = l.itemTop(index);
        const size = (index + 1 < l.count ? l.itemTop(index + 1) : l.height) - top;
        // Already wholly on screen: left where it is.
        const shown = top - drawnShift.current;
        if (more <= 0 && shown >= at && shown + size <= at + page) return;
        // Where the page would be with the item in the middle of the screen, were the list its full height.
        const wanted = Math.max(0, top - (page - size) / 2);
        const to = more <= 0 ? wanted : Math.min(range, wanted / (1 + more / range));
        last.current.jump = true;
        const by = to - at;
        if (scroller) scroller.scrollTop += by;
        else window.scrollBy({ top: by });
        // Nothing to scroll (already there): the shift is still set for it.
        if (Math.abs(by) < 0.5) follow();
      },
      // An item's own top is this plus where the layout puts it.
      top: () => (anchor.current?.getBoundingClientRect().top ?? 0) - drawnShift.current,
    }),
    [scroller, where, follow],
  );
  const rows: ReactNode[] = [];
  for (let i = first; i <= lastDrawn; i++) {
    const item = items[i]!;
    const top = layout.itemTop(i);
    const height = (i + 1 < count ? layout.itemTop(i + 1) : layout.height) - top;
    rows.push(
      <div
        key={keyOf(item)}
        style={{ position: "absolute", top: top - drawn.shift, left: 0, right: 0, height, zIndex: raised?.(item) ? 1 : undefined }}
      >
        {render(item, i)}
      </div>,
    );
  }
  return (
    <div ref={anchor} style={{ position: "relative", height: laidOut }}>
      {scroller !== undefined && rows}
    </div>
  );
}
