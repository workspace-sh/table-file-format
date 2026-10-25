// The Mac's own controls for table-ui's slots (PlatformControlsProvider):
// where the views offer a list of choices or a row's actions, the system's
// menu shows them, and a date the system's date picker (macos/), as the
// system's controls do on iOS. table-ui's pointer defaults draw a menu of
// their own, which suits a browser and is what this replaces. Any
// react-native-macos app drawing the .table library's views uses these:
// give `macControls` to PlatformControlsProvider, call `watchRowMenus()`
// once, and link the TableMacControls pod.

import { cloneElement, forwardRef, useEffect, useId, useImperativeHandle, useRef, type ReactElement } from "react";
import { Pressable, requireNativeComponent, type View, type ViewProps } from "react-native";
import { html, css } from "react-strict-dom";
import { dateOfStored, storedOfDate } from "@workspace.sh/table-ui/shared";
import type { ChooseManyProps, ChooseManySlot, DateInputProps, DateInputSlot, MenuAction, PlatformControls, RowActionsProps, RowActionsSlot, SelectHandle, SelectProps, SelectSlot, ToggleProps, ToggleSlot } from "@workspace.sh/table-ui/shared";
import { chooseMany, chooseManyClose, onContextMenu, pickDate, popUpMenu, type PopUpItem } from "./native";

export { MacSettingsForm, cancelSettingsForm, dismissSettingsForm, macSheet, onSettingsFormEvent, settingsFormJson, settingsFormShown, setSettingsTransport, type SettingsFormEvent, type SettingsTransport } from "./settings";
export { datePickerClose, datePickerSet, datePickerShown, onContextMenu, pickDate, popUpChoose, popUpMenu, popUpTitles, type PopUpItem } from "./native";

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

/**
 * A date, a time, or both, in the system's date picker: a click on the
 * selected cell opens it in a popover pointing at the cell. Typing on the
 * cell still opens its text editor, so a typed or pasted date still parses.
 */
function DateInputView({ kind, value, onChange, label, trigger }: DateInputProps): ReactElement {
  const anchor = useRef<View | null>(null);
  // The cell's view, found by this id: the popover points at it wherever it has scrolled.
  const id = `date-${useId()}`;
  const open = () =>
    anchor.current?.measure((_x, _y, width, height, x, y) => {
      void pickDate(kind, dateOfStored(kind, value)?.getTime() ?? null, { x, y, width, height }, id).then((chosen) => {
        if (chosen === null) return;
        const next = storedOfDate(kind, new Date(chosen));
        if (next !== value) onChange(next);
      });
    });
  return (
    <Pressable ref={anchor} nativeID={id} onPress={open} accessibilityRole="button" accessibilityLabel={label} style={{ alignSelf: "stretch", flexDirection: "row", flex: 1 }}>
      {trigger}
    </Pressable>
  );
}

export const MacDateInput: DateInputSlot = Object.assign(DateInputView, { available: true });

// What has a menu, by the id its element carries: a right-click arrives
// from the window (onContextMenu) with the id of what was clicked.
const menus = new Map<string, { actions: MenuAction[] }>();

/** A row's actions, in the system's menu at the pointer on a right-click (or Control-click). */
function RowActionsView({ actions, children }: RowActionsProps): ReactElement {
  const id = `menu-${useId()}`;
  const row = useRef<{ actions: MenuAction[] }>({ actions });
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

/**
 * Several choices (a multi-select's tags, a link to several rows) in a
 * popover of the system's pointing at the cell: each toggles as it's
 * picked, and the list stays open (TableChoicePicker.swift). Drawn while
 * the views have it open; nothing of its own is drawn here.
 */
function ChooseManyView({ options, selected, onToggle, anchor, rect, onClose }: ChooseManyProps): null {
  const latest = useRef({ onToggle, onClose });
  latest.current = { onToggle, onClose };
  useEffect(() => {
    let open = true;
    void chooseMany(options, selected, rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : { x: 0, y: 0, width: 0, height: 0 }, anchor, (value) =>
      latest.current.onToggle(value),
    ).then(() => {
      if (open) latest.current.onClose();
    });
    return () => {
      open = false;
      chooseManyClose();
    };
    // Opened once, with the choices as they were: it ticks its own as they're picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  return null;
}

export const MacChooseMany: ChooseManySlot = ChooseManyView;

/** The Mac's controls, for PlatformControlsProvider. One object, so the views' rows aren't remounted. */
/** The system's checkbox (macos/TableCheckbox.m). */
const NativeCheckbox = requireNativeComponent<ViewProps & { checked: boolean; label?: string; onChange: (event: { nativeEvent: { checked: boolean } }) => void }>("TableCheckbox");

/**
 * A boolean cell or a setting, as the system's checkbox: in a cell alone,
 * in a setting with its text beside it, which flips it too.
 */
function ToggleView({ checked, onChange, label, children, style }: ToggleProps): ReactElement {
  const box = <NativeCheckbox checked={checked} label={label ?? children} onChange={(e) => onChange(e.nativeEvent.checked)} style={{ width: 18, height: 18 }} />;
  if (children === undefined) return box;
  return (
    <html.div style={[styles.toggleRow, style as never]}>
      {box}
      <html.span onClick={() => onChange(!checked)} style={styles.toggleText}>
        {children}
      </html.span>
    </html.div>
  );
}

export const MacToggle: ToggleSlot = ToggleView;

export const macControls: Partial<PlatformControls> = { Select: MacSelect, RowActions: MacRowActions, DateInput: MacDateInput, ChooseMany: MacChooseMany, Toggle: MacToggle };

const styles = css.create({
  toggleRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toggleText: {
    flexShrink: 1,
    cursor: "default",
  },
  button: {
    cursor: "pointer",
    textAlign: "start",
  },
});
