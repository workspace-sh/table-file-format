// A drop-down's or combo row's selection, set after its model is. GTKX
// applies `selected` while the widget is built, before the model arrives,
// and the model then resets it to the first item: a picker showed its
// first choice, not the view's. This sets it once the model is there, and
// whenever the choice or the list changes.

import type * as Adw from "@gtkx/gi/adw";
import type * as Gtk from "@gtkx/gi/gtk";
import { useEffect, useRef } from "react";

export function useSelected<T extends Gtk.DropDown | Adw.ComboRow>(index: number, listKey: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const w = ref.current;
    if (w && w.getSelected() !== index) w.setSelected(index);
  }, [index, listKey]);
  return ref;
}
