// The Mac's own controls for table-ui's slots (PlatformControlsProvider):
// where the views offer a list of choices or a row's actions, the system's
// menu shows them (native/TablePanels/TableMenu.m), as the system's menus
// do on iOS. table-ui's pointer defaults draw a menu of their own, which
// suits a browser and is what this replaces.

import { cloneElement, forwardRef, useEffect, useId, useImperativeHandle, useRef, type ReactElement } from "react";
import { Pressable, type View } from "react-native";
import { html, css } from "react-strict-dom";
import type { PlatformControls, RowAction, RowActionsProps, RowActionsSlot, SelectHandle, SelectProps, SelectSlot } from "@workspace.sh/table-ui/shared";
import { onContextMenu, popUpMenu, type PopUpItem } from "./menu";

/** No choice: an id of its own, as a menu item needs one. */
const NONE = "\u0000none";

/**
 * One choice from a list, in the system's pop-up menu: the chosen one is
 * ticked and opens under the pointer, as a pop-up button's does. Given a
 * `trigger` (a selected table cell's value), a click on that opens it.
 */
const SelectView = forwardRef<SelectHandle, SelectProps>(function MacSelect(
  { value, options, onChange, onBlur, style, label, trigger },
  ref,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anchor = useRef<any>(null);
  const choose = async (at: { x: number; y: number } | null) => {
    const items: PopUpItem[] = options.map((o) => ({
      id: o.value === "" ? NONE : o.value,
      title: o.label,
      checked: o.value === value,
      disabled: o.disabled,
    }));
    const id = await popUpMenu(items, at);
    if (id === null) onBlur?.();
    else onChange(id === NONE ? "" : id);
  };
  // Opened from the keyboard (Return on a selected cell): over the cell,
  // since the pointer may be anywhere.
  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = anchor.current as View | null;
      if (typeof el?.measure !== "function") return void choose(null);
      el.measure((_x, _y, _width, _height, pageX, pageY) => void choose({ x: pageX, y: pageY }));
    },
  }));
  if (trigger) {
    return (
      <Pressable onPress={() => void choose(null)} style={{ alignSelf: "stretch", flexDirection: "row", flex: 1 }}>
        {trigger}
      </Pressable>
    );
  }
  const chosen = options.find((o) => o.value === value);
  return (
    <html.button
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={(el: any) => {
        anchor.current = el;
      }}
      aria-label={label}
      aria-haspopup="menu"
      onClick={() => void choose(null)}
      style={[styles.button, style as never]}
    >
      {/* One string, so it takes the caller's text style as a button's own label does. */}
      {`${chosen?.label ?? ""}  ▾`}
    </html.button>
  );
});

// Cast: the app and table-ui each resolve their own copy of React's types.
export const MacSelect = Object.assign(SelectView, { opensFromTrigger: true }) as unknown as SelectSlot;

// What has a menu, by the id its element carries: a right-click arrives
// from the window (onContextMenu) with the id of what was clicked.
const menus = new Map<string, { actions: RowAction[] }>();

/** A row's actions, in the system's menu at the pointer on a right-click (or Control-click). */
function RowActionsView({ actions, children }: RowActionsProps): ReactElement {
  const id = `menu-${useId()}`;
  const row = useRef<{ actions: RowAction[] }>({ actions });
  row.current.actions = actions;
  useEffect(() => {
    menus.set(id, row.current);
    return () => void menus.delete(id);
  }, [id]);
  if (actions.length === 0) return children;
  return cloneElement(children as ReactElement<{ id?: string }>, { id });
}

export const MacRowActions: RowActionsSlot = Object.assign(RowActionsView, { gesture: "Right-click a row" });

/** Show the menu of the row right-clicked; returns the way to stop. */
export function watchRowMenus(): () => void {
  return onContextMenu((target) => {
    const actions = menus.get(target)?.actions;
    if (!actions?.length) return;
    const items: PopUpItem[] = [];
    for (const action of actions) {
      // What removes something is set apart, last.
      if (action.destructive && items.length) items.push({ separator: true });
      items.push({ id: action.id, title: action.label, symbol: action.symbol?.sf });
    }
    void popUpMenu(items).then((chosen) => actions.find((a) => a.id === chosen)?.onSelect());
  });
}

/** The Mac's controls, for PlatformControlsProvider. One object, so the views' rows aren't remounted. */
export const macControls: Partial<PlatformControls> = { Select: MacSelect, RowActions: MacRowActions };

const styles = css.create({
  button: {
    cursor: "pointer",
    textAlign: "start",
  },
});
