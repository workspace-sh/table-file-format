// The keyboard in a table's grid, whatever draws it: which cell an arrow,
// Tab, Home or End leads to, and what Enter, Delete, Space or a typed
// character does to the selected one. Pure: a place in, a decision out.
// The web's TableView and table-gtk's both run it.

import { enumOptions, type Field } from "@workspace.sh/table-core";

/** A cell by its place: row and column, from 0. */
export interface GridPlace {
  row: number;
  col: number;
}

/** A key as the grid hears it. `jump`: Ctrl or ⌘ held. */
export interface GridKey {
  key: string;
  shift?: boolean;
  jump?: boolean;
  alt?: boolean;
}

/** What the selected cell's column is, for what a key does to it. */
export interface GridCell {
  editable: boolean;
  /** A checkbox: Space and Enter flip it; nothing's typed into it. */
  boolean: boolean;
  /** Typing opens its picker rather than replacing its text: choices, lists, dates. */
  picks: boolean;
  /** A formula: Enter opens how it was worked out. */
  computed: boolean;
}

export type GridAction =
  /** Select this cell (clamped to the grid). */
  | { kind: "select"; at: GridPlace }
  /** Open the selected cell: its editor (with `text` typed over it), its picker, or its formula. */
  | { kind: "open"; text?: string }
  /** Flip the selected checkbox. */
  | { kind: "toggle" }
  /** Empty the selected cell. */
  | { kind: "clear" }
  /** Drop the selection. */
  | { kind: "deselect" }
  /** Tab past either end: the grid lets the key go, as any control does. */
  | { kind: "leave" };

/** How a cell's editor was closed from the keyboard. */
export type EditEnd = "enter" | "tab" | "shift-tab" | "escape" | "done";

/** What typing a character into a column does: open its picker (true), or replace its text. */
export function cellPicks(field: Field | undefined): boolean {
  return enumOptions(field).length > 0 || field?.type === "array" || field?.type === "date" || field?.type === "datetime" || field?.type === "time";
}

/** A place kept inside a grid of `rows` × `cols`. */
export function clampPlace(at: GridPlace, rows: number, cols: number): GridPlace {
  return { row: Math.max(0, Math.min(rows - 1, at.row)), col: Math.max(0, Math.min(cols - 1, at.col)) };
}

/** Tab's next place, reading along the rows; null past either end. */
function tabbed(at: GridPlace, back: boolean, rows: number, cols: number): GridPlace | null {
  const i = at.row * cols + at.col + (back ? -1 : 1);
  if (i < 0 || i > rows * cols - 1) return null;
  return { row: Math.floor(i / cols), col: i % cols };
}

/**
 * What `key` does in a grid of `rows` × `cols` with `at` selected (null:
 * nothing is). Null when the grid leaves the key alone. With nothing
 * selected, a key that moves selects the first cell.
 */
export function gridKey(at: GridPlace | null, rows: number, cols: number, k: GridKey, cell: GridCell): GridAction | null {
  if (rows === 0 || cols === 0) return null;
  if (!at) return /^(Arrow|Tab$|Enter$|Home$|End$)/.test(k.key) ? { kind: "select", at: { row: 0, col: 0 } } : null;
  const go = (row: number, col: number): GridAction => ({ kind: "select", at: clampPlace({ row, col }, rows, cols) });
  const { row, col } = at;
  switch (k.key) {
    case "ArrowUp":
      return go(k.jump ? 0 : row - 1, col);
    case "ArrowDown":
      return go(k.jump ? rows - 1 : row + 1, col);
    case "ArrowLeft":
      return go(row, k.jump ? 0 : col - 1);
    case "ArrowRight":
      return go(row, k.jump ? cols - 1 : col + 1);
    case "Home":
      return go(k.jump ? 0 : row, 0);
    case "End":
      return go(k.jump ? rows - 1 : row, cols - 1);
    case "Tab": {
      const next = tabbed(at, !!k.shift, rows, cols);
      return next ? { kind: "select", at: next } : { kind: "leave" };
    }
    case "Enter":
    case "F2":
      if (cell.boolean) return cell.editable ? { kind: "toggle" } : null;
      return cell.editable || cell.computed ? { kind: "open" } : null;
    case "Escape":
      return { kind: "deselect" };
    case "Backspace":
    case "Delete":
      return cell.editable && !cell.boolean ? { kind: "clear" } : null;
    case " ":
      return cell.boolean && cell.editable ? { kind: "toggle" } : null;
    default:
      // A character typed on a cell replaces what's in it; choices, lists
      // and dates open their picker instead.
      if (k.key.length === 1 && !k.jump && !k.alt && cell.editable && !cell.boolean) return cell.picks ? { kind: "open" } : { kind: "open", text: k.key };
      return null;
  }
}

/** Where the selection goes once a cell's editor closes from the keyboard. */
export function afterEdit(at: GridPlace, how: EditEnd, rows: number, cols: number): GridPlace {
  if (how === "enter") return clampPlace({ row: at.row + 1, col: at.col }, rows, cols);
  if (how === "tab" || how === "shift-tab") return tabbed(at, how === "shift-tab", rows, cols) ?? at;
  return at;
}
