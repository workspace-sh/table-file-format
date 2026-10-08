/**
 * An editor outside the table, which a host can provide (#352): on iOS, one
 * Liquid Glass control at the bottom of the screen shows the selected cell
 * and edits it, instead of a field opening inside a narrow cell. The table
 * reports its selection and hands each edit over as a session; the cell
 * keeps showing the draft as it is typed, so editing still reads as in
 * place. With no provider, cells edit in place as before.
 */
import { createContext, useContext } from "react";

/** The selected cell, as the editor shows it before editing. */
export interface CellEditorSelection {
  rowId: string;
  name: string;
  /** The field's title. */
  label: string;
  /** The row's title, to say which row. */
  rowLabel: string;
  /** The value as text, or the formula as typed. */
  text: string;
  /** A formula column: `text` is its formula. */
  formula: boolean;
  /** The field's description (SPEC section 2: its help), if it has one. */
  description?: string;
  /**
   * What the column is, a line each: its kind and rules, description,
   * formula and stored key; what the web shows when a header is hovered.
   */
  facts?: string;
}

/** What the editor shows about a draft as it changes. */
export interface CellEditStatus {
  /**
   * Why it can't be saved, and a fix the editor can offer: `fix`, text to
   * insert at the cursor (a missing bracket); `replace`, a whole value to
   * save instead (a two-digit year read as this century).
   */
  error?: { message: string; fix?: string; replace?: string };
  /** This row's result with the draft (a formula). */
  result?: string;
}

/** One edit, handed to the editor by a cell. */
export interface CellEditSession {
  /** Changes for every edit, so the editor starts a fresh field. */
  key: string;
  rowId: string;
  name: string;
  label: string;
  rowLabel: string;
  initial: string;
  /** `line`: a value, Return saves; `formula`: grows, Return saves; `text`: grows, Return is a new line. */
  mode: "line" | "formula" | "text";
  keyboard?: "default" | "decimal-pad" | "numeric" | "numbers-and-punctuation" | "email-address" | "url" | "phone-pad";
  /** Shown before the typed value, as the web's cell shows it: a currency's symbol. */
  prefix?: string;
  /** Word suggestions, autocorrection and capitals: prose only, never a number, code or formula. */
  suggestions?: boolean;
  /** A choice field: picked, not typed. Each in its colours, as its pill is drawn. */
  choices?: { id: string; label: string; colors?: { light: { bg: string; fg: string }; dark: { bg: string; fg: string } } }[];
  /** Add a new choice to the field and pick it. */
  addChoice?(label: string): void;
  selected?: string;
  /** A multi-select: each choice turns on or off, saved as it's tapped. */
  multiple?: boolean;
  selectedMany?: string[];
  /** Turn one choice on or off and save; returns what's now on. */
  toggle?(id: string): string[];
  /** A date, time, or date and time: picked from the system's calendar. */
  date?: {
    value?: Date;
    components: ("date" | "hourAndMinute")[];
    /** The value as shown. */
    shown: string;
    /** Save a picked date; returns what to show for it. */
    pick(date: Date): { ok: true; shown: string } | { ok: false; error: { message: string } };
  };
  /** The draft changed (the cell shows it); returns what to say about it. */
  change(text: string): CellEditStatus;
  /** Save. Refused, the edit stays open with the reason (the draft can't be held). */
  save(text: string): { ok: true } | { ok: false; error: { message: string; fix?: string; replace?: string } };
  /**
   * Empty the cell and end the edit, as the Delete key does on the web: a
   * single choice, a single link or a date, which have nothing to type away.
   */
  clear?(): void;
  /** Discard the edit. */
  cancel(): void;
  /** After a save by Return: move down a row and edit there. */
  next(): void;
}

/** What the table can be asked to do by the editor. */
export interface CellEditorCommands {
  deselect(): void;
  /** Edit the selected cell, as a second tap on it does. */
  editSelected(): void;
  /** Report where the selected cell is again (`reveal`), as when the editor changes size. */
  revealSelected?(): void;
  /** Open a field's settings, as clicking its heading does. Absent where the schema can't be edited. */
  openFieldSettings?(name: string): void;
}

export interface CellEditor {
  select(selection: CellEditorSelection | null): void;
  /** Take over an edit; false leaves the cell to edit in place. */
  begin(session: CellEditSession): boolean;
  /** The cell's edit ended on the table's side (it went away, or another began). */
  end(key: string): void;
  attach(commands: CellEditorCommands | null): void;
  /**
   * Keep this cell in view while it's edited: where it is on screen
   * (window coordinates) as its edit begins.
   */
  reveal?(rect: { top: number; left: number; width: number; height: number }): void;
  /**
   * While a formula is being edited, a tap on a cell may add a reference
   * to it (`reference`: the column's name, or its coordinate in a sheet)
   * instead of selecting it. Returns true when it did.
   */
  tapWhileEditing?(rowId: string, name: string, reference: string): boolean;
}

export const CellEditorContext = createContext<CellEditor | null>(null);

/** The host's editor, if it provides one. */
export function useCellEditor(): CellEditor | null {
  return useContext(CellEditorContext);
}
