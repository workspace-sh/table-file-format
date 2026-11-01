import { Fragment, useEffect, useImperativeHandle } from "react";
import type { RowListProps } from "./RowList.types";

export type { RowListHandle, RowListProps } from "./RowList.types";

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
