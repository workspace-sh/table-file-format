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
}

/** What the editor shows about a draft as it changes. */
export interface CellEditStatus {
  /** Why it can't be saved, and a fix the editor can offer (text to insert). */
  error?: { message: string; fix?: string };
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
  /** Word suggestions, autocorrection and capitals: prose only, never a number, code or formula. */
  suggestions?: boolean;
  /** A choice field: picked, not typed. */
  choices?: { id: string; label: string }[];
  selected?: string;
  /** The draft changed (the cell shows it); returns what to say about it. */
  change(text: string): CellEditStatus;
  /** Save. Refused, the edit stays open with the reason (the draft can't be held). */
  save(text: string): { ok: true } | { ok: false; error: { message: string; fix?: string } };
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
}

export interface CellEditor {
  select(selection: CellEditorSelection | null): void;
  /** Take over an edit; false leaves the cell to edit in place. */
  begin(session: CellEditSession): boolean;
  /** The cell's edit ended on the table's side (it went away, or another began). */
  end(key: string): void;
  attach(commands: CellEditorCommands | null): void;
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
