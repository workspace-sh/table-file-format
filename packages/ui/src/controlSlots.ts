// The controls a host can replace with its own (PlatformControlsProvider),
// as types every renderer shares: the views draw these slots with each
// platform's own control by default (a context menu on iOS, Material's on
// Android, a pointer menu on the web and macOS), and an app passes its
// own where it wants something else. Free of any renderer, as shared.ts.

import type { ForwardRefExoticComponent, ReactElement, ReactNode, RefAttributes } from "react";
import type { AnchorRect } from "./internal/measureAnchor";

/** An entry of a menu the platform draws: a row's, or a column's. */
interface Action<Id extends string> {
  id: Id;
  /** In title case, as menus are on every platform (Apple's and GNOME's guidelines). */
  label: string;
  /** The action's symbol where the platform shows one: an SF Symbol on iOS, a Material Symbol on Android. */
  symbol?: { sf?: string; material?: string };
  /** Removes something: shown as destructive (red), last. */
  destructive?: boolean;
  onSelect: () => void;
}

/** Something that can be done to a row as a whole, from its row menu. */
export type RowAction = Action<"open-page" | "add-page" | "insert-above" | "insert-below" | "cell-note" | "merge-cells" | "unmerge-cells" | "hide-row" | "fit-row" | "reset-row-height" | "delete">;

/** Something that can be done to a column, from its header's menu (columnActions). */
export type FieldAction = Action<"insert-left" | "insert-right" | "reset-width" | "delete-field">;

/** Either: what a menu drawn by the RowActions slot is made of. */
export type MenuAction = RowAction | FieldAction;

/**
 * The RowActions slot: wraps a row (`children`, one element) and offers
 * its `actions` the platform's way. iOS: touch and hold for a context
 * menu. Android: touch and hold for a dropdown menu. Web and macOS:
 * right-click for a menu at the pointer. With no actions it draws the row
 * as it is.
 */
export interface RowActionsProps {
  actions: MenuAction[];
  children: ReactElement;
  /** The row's title as shown, for a menu that names the row (the defaults lift or point at the row itself). */
  title?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** A choice's colour (EnumColor), for a control that draws choices as tags. */
  color?: string;
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

/**
 * Several choices from a list, opened over a cell (a multi-select's
 * tags, a link to several rows): each choice toggles as it's picked and
 * the list stays open, as a quick choice should. The platform's own: a
 * popover of the system's on a Mac. Absent, the views draw their own menu.
 */
export interface ChooseManyProps {
  options: { value: string; label: string; /** A choice's colour's name (EnumColor), for its tag. */ color?: string }[];
  /** The values chosen now. */
  selected: string[];
  /** A choice picked: on if it was off, off if it was on. */
  onToggle: (value: string) => void;
  /** The cell it opens from: the `id` its element carries, and where it is as React measures. */
  anchor: string;
  rect: AnchorRect | null;
  /** Closed: by a click outside, Escape or Return. */
  onClose: () => void;
}

/** A ChooseMany control, or null where the views draw their own. */
export type ChooseManySlot = ((props: ChooseManyProps) => ReactElement | null) | null;

/**
 * One of a list, picked from a popover pointing at the element whose `id` is
 * `anchor` (the Mac's, the same as ChooseMany's): the rows of a calendar's
 * day, say. A pick or a click outside closes it.
 */
export interface ChooseOneProps {
  options: { value: string; label: string; color?: string }[];
  anchor: string;
  onPick: (value: string) => void;
  onClose: () => void;
}

/** A ChooseOne control, or null where the views draw their own (a sheet). */
export type ChooseOneSlot = ((props: ChooseOneProps) => ReactElement | null) | null;

/** A DateInput control; `available` false where cells type their dates instead. */
export type DateInputSlot = ((props: DateInputProps) => ReactElement) & { available?: boolean };

/**
 * The Toggle slot: on or off. A `setting` (a view's or a field's option,
 * with its text beside it) is the platform's switch on a phone: SwiftUI's
 * Toggle on iOS, Material's Switch on Android. A table `cell` is a
 * symbol a tap flips: a filled check circle or an empty one on iOS,
 * Material's check box on Android. The web and macOS draw a checkbox for
 * both.
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  role: "setting" | "cell";
  /** What it's for, when no text beside it says so. */
  label?: string;
  /** Text beside it, which flips it too. */
  children?: string;
  /** The caller's style for the row holding it and its text (each renderer's own style type). */
  style?: unknown;
}

export type ToggleSlot = (props: ToggleProps) => ReactElement;

/**
 * The Sheet slot: something edited apart from the view (a row's page),
 * presented the platform's way. The web and macOS: a card over the page,
 * with its buttons along the foot. iOS: the system's page sheet, Cancel
 * leading and the confirming action trailing, swiped away when nothing
 * is lost. Android: Material's full-screen dialog, close leading and the
 * confirming action trailing.
 */
export interface SheetProps {
  /**
   * What it's for. A `page` (a row's page) is edited, so it takes the
   * screen. `settings` (a view's settings) change as they're made, so a
   * phone shows them in a sheet that opens part way and can grow.
   */
  size?: "page" | "settings";
  title: string;
  /** Under the title: what's edited (the page's file). */
  subtitle?: string;
  /** Leaving without keeping, where there's such a thing: Cancel in settings puts back what changed since they opened. A page has none: it's saved as it's typed. */
  cancel?: { label: string; onPress: () => void };
  /** Finishing: Done. */
  confirm?: { label: string; onPress: () => void; disabled?: boolean };
  /** A word on the state, where the platform shows one ("Saved"). */
  status?: string;
  /**
   * Whether a swipe or a tap outside may close it: only when nothing is
   * lost. When not, it stays open, and a swipe (iOS) calls `onDismiss` for
   * the caller to ask.
   */
  dismissible: boolean;
  /** Closed, or asked to close, by a swipe or a tap outside. */
  onDismiss: () => void;
  /**
   * What it holds scrolls by itself (a platform's settings form), so the
   * sheet gives it the whole space rather than a scroller of its own.
   */
  fill?: boolean;
  children: ReactNode;
}

/**
 * One row of a settings form (SettingsForm). Each says what it is, not how
 * it's drawn, so a platform can draw it its own way: a SwiftUI Form on
 * iOS, Material list items on Android.
 */
export type SettingsRow =
  /** A text field, labelled. */
  | {
      kind: "text";
      id: string;
      label: string;
      value: string;
      placeholder?: string;
      autoFocus?: boolean;
      onChange: (value: string) => void;
      /** Return pressed: the text as typed. */
      onSubmit?: (value: string) => void;
    }
  /** A fact shown, not edited: its label and its value. */
  | { kind: "info"; id: string; label: string; value: string }
  /** One choice from a list, labelled: a menu. */
  | {
      kind: "choice";
      id: string;
      label: string;
      value: string;
      options: SelectOption[];
      /**
       * `menu` (the default): a menu from the row. `inline`: every option a
       * row, the chosen one ticked. `segmented`: a few options side by side.
       */
      style?: "menu" | "inline" | "segmented";
      onChange: (value: string) => void;
    }
  /** On or off, labelled. */
  | { kind: "toggle"; id: string; label: string; value: boolean; onChange: (value: boolean) => void }
  /**
   * Several controls in one row, unlabelled, that together make one thing:
   * a filter (field, operator, value) or a sort (field, direction).
   */
  | { kind: "compound"; id: string; parts: SettingsRow[]; removeLabel: string }
  /** A button row: adding, destroying, or anything else. */
  | { kind: "action"; id: string; label: string; role?: "add" | "destructive"; disabled?: boolean; onPress: () => void };

export interface SettingsSection {
  id: string;
  title?: string;
  /** Under the section: what its rows mean. */
  footer?: string;
  rows: SettingsRow[];
  /**
   * The section's `compound` rows can be removed (a swipe on iOS) and
   * reordered; indices count those rows only, in order.
   */
  onRemove?: (index: number) => void;
  onMove?: (from: number, to: number) => void;
}

export interface SettingsFormProps {
  sections: SettingsSection[];
}

/**
 * A platform's own settings form, or null where the shared layout is drawn
 * instead. `reorderHint` says how its rows are reordered, where that isn't
 * a phone's touch and hold ("Use a row's menu to reorder.").
 */
export type SettingsFormSlot = (((props: SettingsFormProps) => ReactElement) & { reorderHint?: string }) | null;

/**
 * A Sheet control; `presentsSettings` when it shows `settings` as a sheet
 * of its own (a phone's). Where it doesn't (the web, macOS), a view's
 * settings stay a panel in the page, so the caller draws its own.
 */
export type SheetSlot = ((props: SheetProps) => ReactElement) & { presentsSettings?: boolean };

/**
 * Every control a host may replace. Each is optional: what's given is
 * used, and the rest stay the platform's defaults.
 */
export interface PlatformControls {
  RowActions: RowActionsSlot;
  Select: SelectSlot;
  DateInput: DateInputSlot;
  Toggle: ToggleSlot;
  Sheet: SheetSlot;
  SettingsForm: SettingsFormSlot;
  /** Several choices over a cell; absent or null, the views' own menu. */
  ChooseMany?: ChooseManySlot;
  ChooseOne?: ChooseOneSlot;
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
    /** Fit the row's height to what it holds. */
    onFitRow?: (rowId: string) => void;
    /** Only for a row the user has resized: back to the view's height. */
    onResetRowHeight?: (rowId: string) => void;
    onDeleteRow?: (rowId: string) => void;
    /** The selected cell's note, in this row (D57). */
    onCellNote?: () => void;
    /** Leave the row out of this view by hand (D58). */
    onHideRow?: (rowId: string) => void;
    /** Merge a block of a Sheet view's cells, from the selected one (D58). */
    onMergeCells?: () => void;
    /** The selected cell is in a merged block: show its cells again (D58). */
    onUnmergeCells?: () => void;
  },
): RowAction[] {
  const actions: RowAction[] = [];
  const { onOpenBody, onInsertRow, onFitRow, onResetRowHeight, onDeleteRow, onCellNote, onHideRow, onMergeCells, onUnmergeCells } = can;
  // A row's page opens from here, or starts here: on a touch screen
  // the menu is the only way in to a row without one.
  if (onOpenBody) {
    actions.push(
      can.hasBody
        ? { id: "open-page", label: "Open Page", symbol: { sf: "doc.text", material: "description" }, onSelect: () => onOpenBody(rowId) }
        : { id: "add-page", label: "Add Page", symbol: { sf: "doc.badge.plus", material: "note_add" }, onSelect: () => onOpenBody(rowId) },
    );
  }
  if (onInsertRow) {
    actions.push({ id: "insert-above", label: "Insert Row Above", symbol: { sf: "arrow.up.to.line", material: "vertical_align_top" }, onSelect: () => onInsertRow(rowId, "above") });
    actions.push({ id: "insert-below", label: "Insert Row Below", symbol: { sf: "arrow.down.to.line", material: "vertical_align_bottom" }, onSelect: () => onInsertRow(rowId, "below") });
  }
  if (onCellNote) {
    actions.push({ id: "cell-note", label: "Cell Note…", symbol: { sf: "note.text", material: "sticky_note_2" }, onSelect: onCellNote });
  }
  if (onUnmergeCells) {
    actions.push({ id: "unmerge-cells", label: "Unmerge Cells", symbol: { sf: "rectangle.split.2x2", material: "grid_view" }, onSelect: onUnmergeCells });
  } else if (onMergeCells) {
    actions.push({ id: "merge-cells", label: "Merge Cells…", symbol: { sf: "rectangle.grid.1x2", material: "select_all" }, onSelect: onMergeCells });
  }
  if (onHideRow) {
    actions.push({ id: "hide-row", label: "Hide Row", symbol: { sf: "eye.slash", material: "visibility_off" }, onSelect: () => onHideRow(rowId) });
  }
  if (onFitRow) {
    actions.push({ id: "fit-row", label: "Fit Row to Content", symbol: { sf: "arrow.up.and.down", material: "height" }, onSelect: () => onFitRow(rowId) });
  }
  if (onResetRowHeight) {
    actions.push({ id: "reset-row-height", label: "Reset Row Height", symbol: { sf: "arrow.counterclockwise", material: "restart_alt" }, onSelect: () => onResetRowHeight(rowId) });
  }
  if (onDeleteRow) {
    actions.push({ id: "delete", label: "Delete Row", symbol: { sf: "trash", material: "delete" }, destructive: true, onSelect: () => onDeleteRow(rowId) });
  }
  return actions;
}

/**
 * What a column's header menu offers (right-click, or touch and hold), in
 * order. Inserting is by what's seen, left or right, so in a right-to-left
 * layout "Left" is after the column in field order.
 */
export function columnActions(
  name: string,
  can: {
    onInsertField?: (name: string, side: "before" | "after") => void;
    /** Only for a column the user has resized: back to its share of the width. */
    onResetWidth?: (name: string) => void;
    onDeleteField?: (name: string) => void;
    rtl?: boolean;
  },
): FieldAction[] {
  const actions: FieldAction[] = [];
  const { onInsertField, onResetWidth, onDeleteField, rtl } = can;
  if (onInsertField) {
    actions.push({
      id: "insert-left",
      label: "Insert Field Left",
      symbol: { sf: "arrow.left.to.line", material: "first_page" },
      onSelect: () => onInsertField(name, rtl ? "after" : "before"),
    });
    actions.push({
      id: "insert-right",
      label: "Insert Field Right",
      symbol: { sf: "arrow.right.to.line", material: "last_page" },
      onSelect: () => onInsertField(name, rtl ? "before" : "after"),
    });
  }
  if (onResetWidth) {
    actions.push({ id: "reset-width", label: "Reset Column Width", symbol: { sf: "arrow.left.and.right", material: "width" }, onSelect: () => onResetWidth(name) });
  }
  if (onDeleteField) {
    actions.push({ id: "delete-field", label: "Delete Field", symbol: { sf: "trash", material: "delete" }, destructive: true, onSelect: () => onDeleteField(name) });
  }
  return actions;
}
