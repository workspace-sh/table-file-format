import { hasColorRules, rowColors, type Row, type RowColors, type TableSchema, type View } from "@workspace.sh/table-core";
import { useMemo } from "react";

const NO_COLORS: RowColors = { cells: {} };

/**
 * A view's colour rules for each row (SPEC section 4, D53): none to work
 * out when the view has none, and each row's worked out once while the
 * rules stay the same.
 */
export function useRowColors(view: Pick<View, "colors">, schema?: TableSchema): (row: Row) => RowColors {
  return useMemo(() => {
    if (!hasColorRules(view)) return () => NO_COLORS;
    const seen = new WeakMap<Row, RowColors>();
    return (row: Row) => {
      let colors = seen.get(row);
      if (!colors) seen.set(row, (colors = rowColors(view, row, schema)));
      return colors;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.colors, schema]);
}
