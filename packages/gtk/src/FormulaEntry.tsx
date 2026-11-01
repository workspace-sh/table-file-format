// Where a formula is typed on GTK: coloured as it is typed, by what each
// stretch is (table-core's formulaSpans, as the Mac's editor and the phone's
// bar colour it), and with the table's columns under it to click into the
// formula where it is waiting for one (table-ui's expectsReference, the rule
// a click or tap on a cell follows on the web, the Mac and phones).

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { AdwWrapBox } from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkEntry, GtkLabel } from "@gtkx/jsx/gtk";
import { coordinateOf, formulaSpans, type Field, type FormulaSpan, type Grid } from "@workspace.sh/table-core";
import { expectsReference } from "@workspace.sh/table-ui/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDark } from "./theme.js";

/** A column that can be clicked into a formula: what it's called, and what is written for it. */
export interface FormulaColumn {
  label: string;
  reference: string;
}

/**
 * The table's columns to offer for a formula (not `except`, the formula's own): named as a click on their
 * cell names them on the web, by coordinate in a sheet's row (`grid.here`) and by column anywhere else.
 */
export function columnsFor(fields: Field[], grid: Grid | undefined, except?: string): FormulaColumn[] {
  return fields
    .filter((f) => f.name !== except && !f.deprecated)
    .map((f) => ({ label: f.title ?? f.name, reference: (grid?.here ? coordinateOf(f.name, grid.here, grid) : null) ?? f.name }));
}

// libadwaita's palette, the shade of each that reads on its background: blue for
// what is read, purple for functions, red for text, green for numbers.
const COLOURS: Record<Exclude<FormulaSpan["kind"], "op">, { light: string; dark: string }> = {
  ref: { light: "#1c71d8", dark: "#78aeed" },
  fn: { light: "#9141ac", dark: "#dc8add" },
  str: { light: "#c01c28", dark: "#ff7b63" },
  num: { light: "#1b8553", dark: "#57e389" },
};
/** Operators and brackets step back: the text's own colour, fainter. */
const OPERATOR_ALPHA = Math.round(0.6 * 65535);

/** A formula's colours as Pango attributes, in the form `Pango.AttrList.fromString` reads. */
export function formulaAttributes(text: string, dark: boolean): string {
  // Pango counts in bytes of UTF-8; the spans are JavaScript's string indices.
  const bytes = (index: number) => Buffer.byteLength(text.slice(0, index), "utf8");
  return formulaSpans(text)
    .map((span) => {
      const range = `${bytes(span.start)} ${bytes(span.end)}`;
      return span.kind === "op" ? `${range} foreground-alpha ${OPERATOR_ALPHA}` : `${range} foreground ${COLOURS[span.kind][dark ? "dark" : "light"]}`;
    })
    .join("\n");
}

export interface FormulaEntryProps {
  text: string;
  onChange: (text: string) => void;
  onActivate?: () => void;
  /** The formula won't save as typed. */
  error?: boolean;
  placeholder?: string;
  /** The columns offered under the entry. None: nothing is offered. */
  columns?: FormulaColumn[];
  /** Between the entry and the columns: the formula's status line. */
  children?: ReactNode;
}

export function FormulaEntry({ text, onChange, onActivate, error, placeholder, columns = [], children }: FormulaEntryProps) {
  const dark = useDark();
  const entry = useRef<Gtk.Entry | null>(null);
  // Where the cursor is, in characters: a column goes in there, when the formula up to it is waiting for one.
  const [cursor, setCursor] = useState(() => Array.from(text).length);
  const waiting = expectsReference(Array.from(text).slice(0, cursor).join(""));
  // Where the cursor goes once an added column is in the entry.
  const cursorAfter = useRef<number | null>(null);
  useEffect(() => {
    if (cursorAfter.current === null || !entry.current) return;
    entry.current.grabFocusWithoutSelecting();
    entry.current.setPosition(cursorAfter.current);
    cursorAfter.current = null;
  });
  const add = (reference: string) => {
    const [selected, from, to] = entry.current?.getSelectionBounds() ?? [false, cursor, cursor];
    const start = selected ? Math.min(from, to) : cursor;
    const end = selected ? Math.max(from, to) : cursor;
    const chars = Array.from(text);
    cursorAfter.current = start + Array.from(reference).length;
    onChange(chars.slice(0, start).join("") + reference + chars.slice(end).join(""));
  };
  return (
    <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      <GtkEntry
        ref={entry}
        text={text}
        placeholderText={placeholder}
        attributes={Pango.AttrList.fromString(formulaAttributes(text, dark)) ?? undefined}
        cssClasses={["monospace", ...(error ? ["error"] : [])]}
        onChanged={(e) => onChange(e.getText())}
        onNotifyCursorPosition={(position) => setCursor(position ?? 0)}
        onActivate={onActivate}
      />
      {children}
      {columns.length > 0 ? (
        <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6} marginTop={6}>
          <GtkLabel
            label={waiting ? "Click a column to add it" : "After an operator, a bracket or a comma, click a column to add it"}
            xalign={0}
            wrap
            cssClasses={["dim-label", "caption"]}
          />
          <AdwWrapBox childSpacing={6} lineSpacing={6}>
            {columns.map((column) => (
              <GtkButton
                key={column.reference}
                label={column.label}
                tooltipText={`Add ${column.reference}`}
                sensitive={waiting}
                focusOnClick={false}
                onClicked={() => add(column.reference)}
              />
            ))}
          </AdwWrapBox>
        </GtkBox>
      ) : null}
    </GtkBox>
  );
}
