import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RowListProps } from "./RowList";

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
export function RowList<T>({ items, keyOf, sizeOf, render, version, raised, handle }: RowListProps<T>) {
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
