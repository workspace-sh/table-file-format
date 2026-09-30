// A GDK key press as table-ui's gridKey hears it: its name as the web
// says it ("ArrowDown", "Tab", "Enter", "a"), and the modifiers held.

import * as Gdk from "@gtkx/gi/gdk";
import type { GridKey } from "@workspace.sh/table-ui/shared";

const NAMED = new Map<number, string>([
  [Gdk.KEY_Up, "ArrowUp"],
  [Gdk.KEY_Down, "ArrowDown"],
  [Gdk.KEY_Left, "ArrowLeft"],
  [Gdk.KEY_Right, "ArrowRight"],
  [Gdk.KEY_Home, "Home"],
  [Gdk.KEY_End, "End"],
  [Gdk.KEY_Tab, "Tab"],
  [Gdk.KEY_ISO_Left_Tab, "Tab"],
  [Gdk.KEY_Return, "Enter"],
  [Gdk.KEY_KP_Enter, "Enter"],
  [Gdk.KEY_F2, "F2"],
  [Gdk.KEY_Escape, "Escape"],
  [Gdk.KEY_BackSpace, "Backspace"],
  [Gdk.KEY_Delete, "Delete"],
  [Gdk.KEY_space, " "],
]);

/** The key, or null for one the grid has no use for (a lone modifier). */
export function gridKeyOf(keyval: number, state: number): GridKey | null {
  const shift = (state & Gdk.ModifierType.SHIFT_MASK) !== 0 || keyval === Gdk.KEY_ISO_Left_Tab;
  const jump = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
  const alt = (state & Gdk.ModifierType.ALT_MASK) !== 0;
  const named = NAMED.get(keyval);
  if (named) return { key: named, shift, jump, alt };
  const code = Gdk.keyvalToUnicode(keyval);
  if (code < 32 || code === 127) return null;
  return { key: String.fromCodePoint(code), shift, jump, alt };
}
