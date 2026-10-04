// iOS: the table's outside editor (table-ui's CellEditor) driving the glass
// bar (#352). The table reports its selection and hands over each edit as
// a session; this keeps them, and turns them, with search, into what the
// bar shows. The bar's callbacks go back to the session or the table.

import { useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import type { CellEditor, CellEditorCommands, CellEditorSelection, CellEditSession, CellEditStatus } from "@workspace.sh/table-ui";
import type { GlassBarAction, GlassBarHandle, GlassBarProps, GlassBarState } from "@workspace.sh/glass-bar";

/** Operators for a formula, as one toolbar group of SF Symbols. */
const OPERATORS = [
  { id: "+", label: "Plus", symbol: "plus", insert: " + " },
  { id: "-", label: "Minus", symbol: "minus", insert: " - " },
  { id: "*", label: "Times", symbol: "multiply", insert: " * " },
  { id: "/", label: "Divided by", symbol: "divide", insert: " / " },
  { id: "()", label: "Brackets", symbol: "parentheses", insert: "()", cursorBack: 1 },
];

/** After one of these, a tap on a cell adds a reference to it rather than selecting it. */
const EXPECTS_REFERENCE = /[-+*/(=,]\s*$/;

function sameSelection(a: CellEditorSelection | null, b: CellEditorSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.rowId === b.rowId && a.name === b.name && a.text === b.text && a.label === b.label && a.rowLabel === b.rowLabel;
}

export interface GlassEditorOptions {
  query: string;
  onQuery: (query: string) => void;
  onFilter: () => void;
  moreActions?: GlassBarAction[];
}

export function useGlassEditor({ query, onQuery, onFilter, moreActions }: GlassEditorOptions) {
  const [selection, setSelection] = useState<CellEditorSelection | null>(null);
  const [session, setSession] = useState<CellEditSession | null>(null);
  const [status, setStatus] = useState<CellEditStatus>({});
  const [searching, setSearching] = useState(false);
  const bar = useRef<GlassBarHandle>(null);
  const commands = useRef<CellEditorCommands | null>(null);
  // What's typed, and the open session, for the table's taps, which come
  // from outside React's render.
  const typed = useRef("");
  const open = useRef<CellEditSession | null>(null);

  const editor = useMemo<CellEditor>(
    () => ({
      // Reported on every render of the table: only a change is news.
      select: (next) => setSelection((prev) => (sameSelection(prev, next) ? prev : next)),
      begin: (next) => {
        open.current = next;
        typed.current = next.initial;
        setSession(next);
        setSearching(false);
        setStatus(next.mode === "formula" ? next.change(next.initial) : {});
        return true;
      },
      end: (key) => {
        if (open.current?.key !== key) return;
        open.current = null;
        setSession(null);
        setStatus({});
      },
      attach: (c) => {
        commands.current = c;
      },
      tapWhileEditing: (_rowId, _name, reference) => {
        if (open.current?.mode !== "formula" || !EXPECTS_REFERENCE.test(typed.current)) return false;
        bar.current?.insert(reference);
        return true;
      },
    }),
    [],
  );

  const close = () => {
    open.current = null;
    setSession(null);
    setStatus({});
  };

  let state: GlassBarState;
  if (searching) state = { kind: "searching", query };
  else if (session?.choices) {
    state = { kind: "choosing", label: session.label, detail: session.rowLabel, choices: session.choices, selected: session.selected };
  } else if (session) {
    const formula = session.mode === "formula";
    state = {
      kind: "editing",
      editKey: session.key,
      label: formula && EXPECTS_REFERENCE.test(typed.current) ? "Tap a column to add it" : session.label,
      detail: status.result !== undefined ? `${session.rowLabel}  ${status.result}` : session.rowLabel,
      initialValue: session.initial,
      mode: session.mode,
      keyboard: session.keyboard,
      chips: formula ? OPERATORS : undefined,
      error: status.error ? { message: status.error.message, fixLabel: status.error.fix ? `Add ${status.error.fix}` : undefined } : undefined,
    };
  } else if (selection) {
    state = {
      kind: "selected",
      label: selection.formula ? `ƒ ${selection.label} · every row · ${selection.rowLabel}` : `${selection.label} · ${selection.rowLabel}`,
      value: selection.text,
      monospaced: selection.formula,
    };
  } else state = { kind: "rest", query };

  const save = (text: string, then?: () => void) => {
    const s = open.current;
    if (!s) return;
    const r = s.save(text);
    if (!r.ok) {
      setStatus({ error: r.error });
      return;
    }
    close();
    if (then) then();
    else Keyboard.dismiss();
  };

  const props: GlassBarProps = {
    state,
    moreActions,
    onFilter,
    onSearch: () => setSearching(true),
    onQueryChange: onQuery,
    onSearchEnd: () => {
      setSearching(false);
      Keyboard.dismiss();
    },
    onClearQuery: () => onQuery(""),
    onDeselect: () => commands.current?.deselect(),
    onEdit: () => commands.current?.editSelected(),
    onCancel: () => {
      open.current?.cancel();
      close();
      Keyboard.dismiss();
    },
    onChange: (text) => {
      typed.current = text;
      const s = open.current;
      if (s) setStatus(s.change(text));
    },
    onSave: (text) => save(text),
    // Return: a value saves and moves down a row, still editing; a formula saves.
    onSubmit: (text) => {
      const s = open.current;
      save(text, s && s.mode === "line" ? () => s.next() : undefined);
    },
    onFix: () => {
      if (status.error?.fix) bar.current?.insert(status.error.fix);
    },
    onChoose: (id) => save(id),
  };

  return {
    editor,
    bar,
    props,
    /** The table is being scrolled: an open edit is saved, as the keyboard goes. */
    onScrollBegin: () => {
      if (open.current && !open.current.choices) save(typed.current);
    },
  };
}
