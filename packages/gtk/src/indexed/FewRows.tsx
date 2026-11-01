// A view of a large table (read through its index) in a layout other than
// the table's, which draws every row it is given: its rows, all of them, when
// there are few enough; otherwise it says how to get there.

import { AdwStatusPage } from "@gtkx/jsx/adw";
import { GtkBox } from "@gtkx/jsx/gtk";
import type { Row, ViewRows } from "@workspace.sh/table-core";
import { useEffect, useState, type ReactNode } from "react";

/** The most rows a layout that draws every row it's given is handed, of a table held in the index. */
export const LAYOUT_ROWS = 5000;

/**
 * A view's rows out of the index, all of them, for a layout that isn't the
 * table's: when there are few enough. Otherwise it says how to get there.
 */
export function FewRows({ source, children }: { source: ViewRows; children: (rows: Row[]) => ReactNode }) {
  const [read, setRead] = useState<{ version: string; rows: Row[] } | null>(null);
  const few = source.count <= LAYOUT_ROWS;
  useEffect(() => {
    if (!few) return;
    let current = true;
    void Promise.resolve(source.rows(0, source.count)).then((rows) => current && setRead({ version: source.version, rows }));
    return () => {
      current = false;
    };
  }, [source, few]);
  if (!few) {
    return (
      <AdwStatusPage
        vexpand
        title="Too Many Rows for This Layout"
        description={`This view shows ${source.count.toLocaleString()} rows. Layouts other than Table show up to ${LAYOUT_ROWS.toLocaleString()}: add a filter in View Settings, search, or change the layout to Table.`}
      />
    );
  }
  // The last rows read stay until the next arrive, so an edit doesn't blank the view.
  return read ? <>{children(read.rows)}</> : <GtkBox vexpand />;
}

