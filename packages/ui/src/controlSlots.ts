// The controls a host can replace with its own (PlatformControlsProvider),
// as types every renderer shares: the views draw these slots with each
// platform's own control by default (a context menu on iOS, Material's on
// Android, a pointer menu on the web and macOS), and an app passes its
// own where it wants something else. Free of any renderer, as shared.ts.

import type { ReactElement } from "react";

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

/**
 * Every control a host may replace. Each is optional: what's given is
 * used, and the rest stay the platform's defaults.
 */
export interface PlatformControls {
  RowActions: RowActionsSlot;
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
