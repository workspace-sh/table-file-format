import { Fragment, useEffect, useImperativeHandle, type ReactNode, type Ref } from "react";
import type { RowLayout } from "../rowLayout";

/** What a row list can be asked to do from outside. */
export interface RowListHandle {
  /** Bring the item at `index` into view, if it isn't. */
  scrollIndexIntoView(index: number): void;
  /**
   * The list's top in the window, now: an item's own top is this plus the
   * heights before it, drawn or not. Null where every row is drawn, and a
   * row's place is measured from the row.
   */
  top(): number | null;
}

export interface RowListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The item's height, known before it's drawn: nothing is measured. */
  sizeOf: (item: T, index: number) => number;
  render: (item: T, index: number) => ReactNode;
  /** Changes whenever a height or a drawn row could have, without the items changing. */
  version?: string;
  /** Whether an item is drawn above its neighbours: what hangs below it (the row grip) isn't covered by the next. */
  raised?: (item: T) => boolean;
  handle?: Ref<RowListHandle>;
  /**
   * Where every item is, for a list too tall to lay out as it is: a
   * browser stops placing things some millions of pixels down. Given, the
   * list lays out a body of at most MAX_LIST_HEIGHT and maps scrolling onto
   * the whole of it. Left out for a list that fits.
   */
  layout?: () => RowLayout;
  /** Told the first and last places drawn, as they change: what a list reading its rows from an index asks it for. */
  onShown?: (first: number, last: number) => void;
}

/**
 * A table's rows, one after another. Here every row is drawn; the web's
 * variant (RowList.web.tsx) draws only the rows on screen. Native gets its
 * own when the phone reads large tables (LARGE-TABLES-PLAN, I1).
 */
export function RowList<T>({ items, keyOf, render, handle, onShown }: RowListProps<T>) {
  useImperativeHandle(handle, () => ({ scrollIndexIntoView: () => {}, top: () => null }), []);
  // Every row is drawn here, so every place is shown.
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
