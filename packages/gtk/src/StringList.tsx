// A GtkStringList for a drop-down's or combo row's model. Its strings are
// construct-only in GTK: GTKX refuses a new array, even one with the same
// strings. So the array is kept while its strings are the same, and a
// changed list gets a new key, which makes React build a new list.

import { GtkStringList } from "@gtkx/jsx/gtk";
import { useMemo } from "react";

export function StringList({ strings }: { strings: string[] }) {
  const key = strings.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => strings, [key]);
  return <GtkStringList key={key} strings={stable} />;
}
