import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MAX_LIST_HEIGHT } from "./listLimits";
import type { RowListProps } from "./RowList";
import type { RowLayout } from "../rowLayout";

export type { RowListHandle, RowListProps } from "./RowList";

/** How far past the screen rows are kept drawn, in pixels. */
const DRAW_DISTANCE = 600;

/**
 * A table's rows, drawn only where they're on screen (LARGE-TABLES-PLAN, W1).
 *
 * The list scrolls with the page rather than in a box of its own: it follows
 * the nearest scrolling ancestor (`scrollElement`), so the header above it and
 * the bands below scroll with it as they always have. A table's two panes (the
 * frozen first column, and the rest) are two lists following that same
 * scroller, with the same items and heights, so they always show the same rows
 * side by side.
 *
 * Every height is given up front (`getFixedItemSize`): LegendList stays fast at
 * a million rows only when it never has to measure one.
 */
export function RowList<T>(props: RowListProps<T>) {
  // A list too tall for the browser to lay out is drawn by TallRows, below.
  return props.layout ? <TallRows {...props} layout={props.layout} /> : <ListedRows {...props} />;
}

function ListedRows<T>({ items, keyOf, sizeOf, render, version, raised, handle, onShown }: RowListProps<T>) {
  const anchor = useRef<HTMLDivElement | null>(null);
  const list = useRef<LegendListRef | null>(null);
  // `undefined` until the anchor is in the page; `null` when nothing scrolls
  // but the window itself.
  const [scroller, setScroller] = useState<HTMLElement | null | undefined>(undefined);

  // Before the first paint, so the rows never appear a frame late.
  useLayoutEffect(() => {
    setScroller(scrollParent(anchor.current));
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      scrollIndexIntoView: (index: number) => {
        void list.current?.scrollIndexIntoView({ index, animated: false });
      },
      top: () => anchor.current?.getBoundingClientRect().top ?? null,
    }),
    [],
  );

  // Which places are drawn: the list says, and it's asked as the page
  // scrolls (once a frame) and after each draw. (Its items can't say for
  // themselves: the list keeps the ones scrolled away, to use again.)
  const told = useRef({ first: -1, last: -1, due: false });
  const latestOnShown = useRef(onShown);
  latestOnShown.current = onShown;
  const tell = useCallback(() => {
    told.current.due = false;
    const state = list.current?.getState();
    if (!state || !latestOnShown.current || state.endBuffered < state.startBuffered) return;
    const first = Math.max(0, state.startBuffered);
    const last = state.endBuffered;
    if (first === told.current.first && last === told.current.last) return;
    told.current.first = first;
    told.current.last = last;
    latestOnShown.current(first, last);
  }, []);
  const tellSoon = useCallback(() => {
    if (told.current.due) return;
    told.current.due = true;
    requestAnimationFrame(tell);
  }, [tell]);
  const watching = onShown !== undefined;
  useEffect(() => {
    if (!watching || scroller === undefined) return;
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", tellSoon, { passive: true });
    return () => target.removeEventListener("scroll", tellSoon);
  }, [watching, scroller, tellSoon]);
  useEffect(() => {
    if (watching) tellSoon();
  });

  const renderItem = useCallback(
    ({ item, index }: { item: T; index: number }) => <Lift on={raised?.(item) ?? false}>{render(item, index)}</Lift>,
    [render, raised],
  );

  return (
    <div ref={anchor}>
      {scroller !== undefined && (
        <LegendList
          ref={list}
          data={items}
          keyExtractor={keyOf}
          getFixedItemSize={sizeOf}
          renderItem={renderItem}
          // Cells draw from the table's state (selection, an open editor, a
          // draft), not just from their row, so the rows on screen draw again
          // whenever the table does, as they did before windowing.
          extraData={render}
          {...(version === undefined ? {} : { dataVersion: version })}
          drawDistance={DRAW_DISTANCE}
          {...(scroller === null ? { useWindowScroll: true } : { scrollElement: scroller })}
        />
      )}
    </div>
  );
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

/**
 * Raises the list's own box around an item above the boxes after it, and lets
 * it draw outside its bounds.
 *
 * Each item sits in a positioned box of LegendList's, with paint containment,
 * so anything hanging below the item (the selected row's grip) is clipped at
 * its edge, and a z-index inside the item only orders it within that box. The
 * box is LegendList's and is reused for other items, so it changes only while
 * `on`, and is put back.
 */
function Lift({ on, children }: { on: boolean; children: ReactNode }) {
  const self = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const box = self.current?.parentElement;
    if (!on || !box) return;
    // LegendList's box also has paint containment, which clips what hangs
    // outside it; this one box keeps the rest of its containment.
    const contain = box.style.contain;
    box.style.zIndex = "1";
    box.style.contain = "layout style";
    return () => {
      box.style.zIndex = "";
      box.style.contain = contain;
    };
  }, [on]);
  return (
    <div ref={self} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

/**
 * A list taller than a browser lays out (it stops placing things some
 * millions of pixels down): its rows are placed in a body of
 * MAX_LIST_HEIGHT, and the page's scrolling is mapped onto the whole list.
 *
 * `shift` is how far the rows are from where the page is: the row at the
 * page's place plus `shift` is the one at the top of the screen. Scrolling
 * moves the rows a pixel a pixel, with the shift as it is. A jump (the
 * scrollbar dragged, a key that goes far) sets it by how far down the page
 * is, so the bar's whole travel is the whole list. Two lists side by side
 * hear the same scrolling and so keep the same shift.
 */
function TallRows<T>({ items, keyOf, render, raised, handle, onShown, layout: layoutOf }: RowListProps<T> & { layout: () => RowLayout }) {
  const anchor = useRef<HTMLDivElement | null>(null);
  const layout = layoutOf();
  const laidOut = Math.min(layout.height, MAX_LIST_HEIGHT);
  const extra = layout.height - laidOut;
  const [scroller, setScroller] = useState<HTMLElement | null | undefined>(undefined);
  // What is drawn: a stretch of the list, in its own pixels, and the shift it is drawn at.
  const [drawn, setDrawn] = useState({ from: 0, to: 3 * DRAW_DISTANCE, shift: 0 });
  const last = useRef({ at: 0, jump: false });
  const now = useRef({ laidOut, extra, layout });
  now.current = { laidOut, extra, layout };

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
    const jumped = last.current.jump || Math.abs(at - last.current.at) > 3 * page;
    const atAnEnd = at <= 0 || at >= range - 0.5;
    last.current = { at, jump: false };
    setDrawn((was) => {
      const shift = more <= 0 ? 0 : jumped || atAnEnd ? more * Math.min(1, Math.max(0, at / range)) : Math.min(was.shift, more);
      const top = at + shift;
      return shift === was.shift && top - DRAW_DISTANCE / 2 >= was.from && top + page + DRAW_DISTANCE / 2 <= was.to
        ? was
        : { from: top - DRAW_DISTANCE, to: top + page + DRAW_DISTANCE, shift };
    });
  }, [where]);

  useEffect(() => {
    if (scroller === undefined) return;
    const target: HTMLElement | Window = scroller ?? window;
    let due = false;
    const onScroll = () => {
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
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scroller, follow]);

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
  const drawnShift = useRef(0);
  drawnShift.current = drawn.shift;

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
