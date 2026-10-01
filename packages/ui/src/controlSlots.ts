// The controls a host can replace with its own (PlatformControlsProvider),
// as types every renderer shares: the views draw these slots with each
// platform's own control by default (a context menu on iOS, Material's on
// Android, a pointer menu on the web and macOS), and an app passes its
// own where it wants something else. Free of any renderer, as shared.ts.

import type { ForwardRefExoticComponent, ReactElement, RefAttributes } from "react";

/** Something that can be done to a row as a whole, from its row menu. */
export interface RowAction {
  id: "open-document" | "add-document" | "insert-above" | "insert-below" | "delete";
  /** In title case, as menus are on every platform (Apple's and GNOME's guidelines). */
  label: string;
  /** The action's symbol where the platform shows one: an SF Symbol on iOS, a Material Symbol on Android. */
  symbol?: { sf?: string; material?: string };
  /** Removes something: shown as destructive (red), last. */
  destructive?: boolean;
  onSelect: () => void;
}

/**
 * The RowActions slot: wraps a row (`children`, one element) and offers
 * its `actions` the platform's way. iOS: touch and hold for a context
 * menu. Android: touch and hold for a dropdown menu. Web and macOS:
 * right-click for a menu at the pointer. With no actions it draws the row
 * as it is.
 */
export interface RowActionsProps {
  actions: RowAction[];
  children: ReactElement;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * The Select slot: one choice from a list. The web: the browser's select.
 * iOS: the system's menu (SwiftUI's Picker). Android: Material's dropdown
 * menu. macOS: a button opening a menu of the options.
 */
export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** The caller's style for the select's own button (each renderer's own style type). */
  style?: unknown;
  /** For assistive technology, when nothing beside it names it. */
  label?: string;
  /** Keys pressed while the select (or, on native, its menu) has focus. */
  onKeyDown?: (e: { key: string; shiftKey?: boolean; preventDefault?: () => void }) => void;
  /** Left without choosing: focus moved away, or the menu was dismissed. */
  onBlur?: () => void;
  /**
   * Drawn instead of the select's own button, opening the choices when
   * tapped: a table cell's value, so the cell itself is the menu. Only a
   * select whose `opensFromTrigger` is true takes it.
   */
  trigger?: ReactElement;
}

/** What a ref to a Select can do on every platform: take focus (where it can, opening its menu). */
export interface SelectHandle {
  focus: () => void;
}

/** A Select control; `opensFromTrigger` when it can open its choices from a `trigger`. */
export type SelectSlot = ForwardRefExoticComponent<SelectProps & RefAttributes<SelectHandle>> & { opensFromTrigger?: boolean };

/**
 * The DateInput slot: a date, time, or date and time chosen in the
 * system's picker, for a table cell that's selected. iOS: the system's
 * compact date picker in the cell. Android: a tap on the cell opens
 * Material's date (and time) dialogs. The web and macOS type dates in the
 * cell's editor instead, so their default is unavailable.
 */
export interface DateInputProps {
  kind: "date" | "time" | "datetime";
  /** The stored value ("2026-04-01", "09:30:00", "2026-09-22T14:30:00Z"), or "". */
  value: string;
  /** Called with the value to store, in the same forms. */
  onChange: (value: string) => void;
  /** For assistive technology: the column's name. */
  label?: string;
  /** The cell's value as it's shown, for a picker that opens from it (Android). */
  trigger: ReactElement;
}

/** A DateInput control; `available` false where cells type their dates instead. */
export type DateInputSlot = ((props: DateInputProps) => ReactElement) & { available?: boolean };

/**
 * Every control a host may replace. Each is optional: what's given is
 * used, and the rest stay the platform's defaults.
 */
export interface PlatformControls {
  RowActions: RowActionsSlot;
  Select: SelectSlot;
  DateInput: DateInputSlot;
}

/** A RowActions control, and how a viewer opens it, for the views' hints ("Right-click a row…"). */
export type RowActionsSlot = ((props: RowActionsProps) => ReactElement) & { gesture?: string };

/** What a row's menu offers, in order, from what the view can do. */
export function rowActions(
  rowId: string,
  can: {
    onOpenBody?: (rowId: string) => void;
    hasBody?: boolean;
    onInsertRow?: (rowId: string, where: "above" | "below") => void;
    onDeleteRow?: (rowId: string) => void;
  },
): RowAction[] {
  const actions: RowAction[] = [];
  const { onOpenBody, onInsertRow, onDeleteRow } = can;
  // A row's document opens from here, or starts here: on a touch screen
  // the menu is the only way in to a row without one.
  if (onOpenBody) {
    actions.push(
      can.hasBody
        ? { id: "open-document", label: "Open Document", symbol: { sf: "doc.text", material: "description" }, onSelect: () => onOpenBody(rowId) }
        : { id: "add-document", label: "Add Document", symbol: { sf: "doc.badge.plus", material: "note_add" }, onSelect: () => onOpenBody(rowId) },
    );
  }
  if (onInsertRow) {
    actions.push({ id: "insert-above", label: "Insert Row Above", symbol: { sf: "arrow.up.to.line", material: "vertical_align_top" }, onSelect: () => onInsertRow(rowId, "above") });
    actions.push({ id: "insert-below", label: "Insert Row Below", symbol: { sf: "arrow.down.to.line", material: "vertical_align_bottom" }, onSelect: () => onInsertRow(rowId, "below") });
  }
  if (onDeleteRow) {
    actions.push({ id: "delete", label: "Delete Row", symbol: { sf: "trash", material: "delete" }, destructive: true, onSelect: () => onDeleteRow(rowId) });
  }
  return actions;
}
