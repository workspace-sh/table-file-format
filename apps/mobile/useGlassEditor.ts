// iOS: the table's outside editor (table-ui's CellEditor) driving the glass
// bar (#352). The table reports its selection and hands over each edit as
// a session; this keeps them, and turns them, with search, into what the
// bar shows. The bar's callbacks go back to the session or the table.

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Dimensions, Keyboard } from "react-native";
import type { CellEditor, CellEditorCommands, CellEditorSelection, CellEditSession, CellEditStatus } from "@workspace.sh/table-ui";
import type { GlassBarAction, GlassBarHandle, GlassBarProps, GlassBarState } from "@workspace.sh/glass-bar";
import { expectsReference } from "@workspace.sh/table-ui/shared";

/** Operators for a formula, as one toolbar group of SF Symbols. */
const OPERATORS = [
  { id: "+", label: "Plus", symbol: "plus", insert: " + " },
  { id: "-", label: "Minus", symbol: "minus", insert: " - " },
  { id: "*", label: "Times", symbol: "multiply", insert: " * " },
  { id: "/", label: "Divided by", symbol: "divide", insert: " / " },
  { id: "()", label: "Brackets", symbol: "parentheses", insert: "()", cursorBack: 1 },
];


function sameSelection(a: CellEditorSelection | null, b: CellEditorSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.rowId === b.rowId &&
    a.name === b.name &&
    a.text === b.text &&
    a.label === b.label &&
    a.rowLabel === b.rowLabel &&
    a.description === b.description &&
    a.facts === b.facts
  );
}

export interface GlassEditorOptions {
  query: string;
  onQuery: (query: string) => void;
  onFilter: () => void;
  moreActions?: GlassBarAction[];
  /** Scroll the table by this much (positive: content moves up), to keep a cell in view. */
  onScrollBy?: (dy: number) => void;
}

/** Roughly how tall the editor stands above the keyboard, by what it shows. */
function editorHeight(s: CellEditSession): number {
  if (s.date) return s.date.components.includes("hourAndMinute") ? 500 : 450;
  if (s.choices) return 124;
  if (s.mode === "formula") return 132;
  if (s.mode === "text") return 120;
  return 76;
}
/** Room between the edited cell and the editor below it. */
const CLEARANCE = 28;
/** Taller than this, the editor is expanded. */
const EXPANDED = 300;
/** Under the navigation bar: a cell above this is hidden behind it. */
const TOP = 112;

export function useGlassEditor({ query, onQuery, onFilter, moreActions, onScrollBy }: GlassEditorOptions) {
  const [selection, setSelection] = useState<CellEditorSelection | null>(null);
  const [session, setSession] = useState<CellEditSession | null>(null);
  const [status, setStatus] = useState<CellEditStatus>({});
  const [searching, setSearching] = useState(false);
  // A multi-select's choices that are on, and a date's text, as they change.
  const [many, setMany] = useState<string[]>([]);
  const [shownDate, setShownDate] = useState("");
  // The bar's height as it last laid out; the estimate stands in until it has.
  const barHeight = useRef(0);
  const [laidOut, setLaidOut] = useState(0);
  // The keyboard's height while it's up: the table needs that much more room
  // below its last row for a low cell to scroll clear of the editor.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const subs = [
      Keyboard.addListener("keyboardWillShow", (e) => setKeyboard(e.endCoordinates.height)),
      Keyboard.addListener("keyboardWillHide", () => setKeyboard(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  const scrollBy = useRef(onScrollBy);
  scrollBy.current = onScrollBy;
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
        setMany(next.selectedMany ?? []);
        setShownDate(next.date?.shown ?? "");
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
      // Once the keyboard (if any) is up, scroll so the cell sits between
      // the navigation bar and the editor.
      reveal: (rect) => {
        const s = open.current;
        if (!s) return;
        const place = (keyboard: number) => {
          const tall = barHeight.current > 60 ? barHeight.current : editorHeight(s);
          // Clear of the editor by more than the row grip that hangs below the cell;
          // expanded, the cell has only the row's worth of room above the editor.
          const clear = tall > EXPANDED ? 14 : CLEARANCE;
          const foot = Dimensions.get("window").height - (keyboard > 0 ? keyboard + 8 : 30) - tall - clear;
          const bottom = rect.top + rect.height;
          if (bottom > foot) scrollBy.current?.(bottom - foot);
          else if (rect.top < TOP) scrollBy.current?.(rect.top - TOP);
        };
        if (s.choices || s.date) {
          setTimeout(() => place(0), 220);
          return;
        }
        const up = Keyboard.isVisible() ? Keyboard.metrics() : undefined;
        if (up) {
          setTimeout(() => place(up.height), 380);
          return;
        }
        // The keyboard's height is known only once it has shown, and the
        // first time it shows can take a while: wait for it rather than
        // placing the cell as if there were no keyboard.
        let done = false;
        const settle = (height: number) => {
          if (done) return;
          done = true;
          sub.remove();
          place(height);
        };
        const sub = Keyboard.addListener("keyboardDidShow", (e) => settle(e.endCoordinates.height));
        setTimeout(() => settle(Keyboard.metrics()?.height ?? 0), 1500);
      },
      tapWhileEditing: (_rowId, _name, reference) => {
        if (open.current?.mode !== "formula" || !expectsReference(typed.current)) return false;
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
  else if (session?.date) {
    state = { kind: "dating", label: session.label, detail: session.rowLabel, value: session.date.value, components: session.date.components, shown: shownDate, canClear: !!session.clear };
  } else if (session?.choices) {
    state = {
      kind: "choosing",
      label: session.label,
      detail: session.rowLabel,
      choices: session.choices,
      selected: session.multiple ? many : session.selected,
      multiple: session.multiple,
      canAdd: !!session.addChoice,
      canClear: !!session.clear,
    };
  } else if (session) {
    const formula = session.mode === "formula";
    state = {
      kind: "editing",
      editKey: session.key,
      label: formula && expectsReference(typed.current) ? "Tap a column to add it" : session.label,
      detail: status.result !== undefined ? `${session.rowLabel}  ${status.result}` : session.rowLabel,
      initialValue: session.initial,
      mode: session.mode,
      keyboard: session.keyboard,
      prefix: session.prefix,
      suggestions: session.suggestions,
      chips: formula ? OPERATORS : undefined,
      info: !!session.details,
      // Any text can run long; a number, an email or a link can't.
      expandable: session.mode === "line" && (!session.keyboard || session.keyboard === "default"),
      error: status.error
        ? {
            message: status.error.message,
            fixLabel: status.error.replace ? `Use ${status.error.replace.slice(0, 4)}` : status.error.fix ? `Add ${status.error.fix}` : undefined,
          }
        : undefined,
    };
  } else if (selection) {
    state = {
      kind: "selected",
      label: selection.formula ? `ƒ ${selection.label} · every row · ${selection.rowLabel}` : `${selection.label} · ${selection.rowLabel}`,
      value: selection.text,
      monospaced: selection.formula,
      about: selection.description,
      info: !!selection.facts,
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
    onHeight: (h) => {
      barHeight.current = h;
      setLaidOut(Math.round(h));
    },
    // Grown or shrunk: once it has, put the edited cell just above it again.
    onExpandChange: () => setTimeout(() => commands.current?.revealSelected?.(), 120),
    onSearch: () => setSearching(true),
    onQueryChange: onQuery,
    onSearchEnd: () => {
      setSearching(false);
      Keyboard.dismiss();
    },
    onClearQuery: () => onQuery(""),
    onDeselect: () => commands.current?.deselect(),
    // What the field is, as the web says on hover, and a way into its settings.
    onInfo: () => {
      // Editing a formula: its working, as the web's formula panel shows it.
      const s = open.current;
      if (s?.details) {
        const d = s.details(typed.current);
        const lines = (title: string, items: { label: string; shown: string }[]) =>
          items.length ? [`${title}\n${items.map((i) => `${i.label}: ${i.shown || "—"}`).join("\n")}`] : [];
        const settings = commands.current?.openFieldSettings;
        Alert.alert(
          `${s.label.replace(/^ƒ /, "").replace(/ · every row$/, "")} · ${s.rowLabel}`,
          [
            ...lines("In this row", d.thisRow),
            ...lines("From other rows", d.otherRows),
            `Result: ${d.result || "—"}`,
            ...(d.after !== undefined ? [`After saving: ${d.after || "—"}`] : []),
            "One formula for the whole column: saving it changes every row.",
          ].join("\n\n"),
          [
            ...(settings
              ? [{ text: "Field Settings…", onPress: () => { s.cancel(); close(); Keyboard.dismiss(); settings(s.name); } }]
              : []),
            { text: "OK", style: "cancel" as const },
          ],
        );
        return;
      }
      const sel = selection;
      if (!sel?.facts) return;
      const toSettings = commands.current?.openFieldSettings;
      Alert.alert(sel.label, sel.facts, [
        ...(toSettings ? [{ text: "Field Settings…", onPress: () => toSettings(sel.name) }] : []),
        { text: "OK", style: "cancel" as const },
      ]);
    },
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
    // Empty a single choice, link or date, and close: there's nothing left to edit.
    onClear: () => {
      open.current?.clear?.();
      close();
    },
    // Return: a value saves and moves down a row, still editing; a formula saves.
    onSubmit: (text) => {
      const s = open.current;
      save(text, s && s.mode === "line" ? () => s.next() : undefined);
    },
    // A missing piece goes in at the cursor; a corrected value is saved as it stands.
    onFix: () => {
      const s = open.current;
      if (status.error?.replace) save(status.error.replace, s && s.mode === "line" ? () => s.next() : undefined);
      else if (status.error?.fix) bar.current?.insert(status.error.fix);
    },
    // One choice saves and closes; a multi-select toggles and stays open.
    onChoose: (id) => {
      const s = open.current;
      if (s?.multiple && s.toggle) setMany(s.toggle(id));
      else save(id);
    },
    // A new choice: the system's prompt for its name, then it's added and picked.
    onAddChoice: () => {
      const s = open.current;
      if (!s?.addChoice) return;
      Alert.prompt(`New ${s.label.replace(/^ƒ /, "")} choice`, undefined, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          isPreferred: true,
          onPress: (label?: string) => {
            const name = (label ?? "").trim();
            if (!name) return;
            s.addChoice!(name);
            if (s.multiple) setMany((m) => (m.includes(name) ? m : [...m, name]));
            else close();
          },
        },
      ]);
    },
    // A date saves as it's picked, and stays open to pick again.
    onPickDate: (date) => {
      const r = open.current?.date?.pick(date);
      if (!r) return;
      if (r.ok) setShownDate(r.shown);
      else setStatus({ error: r.error });
    },
  };

  return {
    editor,
    bar,
    props,
    /** Room to leave under the table while an editor stands above the keyboard, so any cell can scroll clear of it. */
    // Kept while a cell is selected, not only while it's edited: Return closes
    // one edit before opening the next, and dropping the room between them
    // would let the table spring back before the next cell is revealed.
    reserve: session || selection ? Math.max(session ? editorHeight(session) : 76, laidOut) + (session?.choices || session?.date ? 0 : keyboard) : 0,
    /** A tap on empty space: save what was typed, close the editor, and deselect. */
    dismiss: () => {
      const s = open.current;
      if (s) {
        if (!s.choices && !s.date) save(typed.current);
        else close();
      }
      setSearching(false);
      Keyboard.dismiss();
      commands.current?.deselect();
    },
    /** The table is being scrolled: an open edit is saved, as the keyboard goes. */
    onScrollBegin: () => {
      if (open.current && !open.current.choices && !open.current.date) save(typed.current);
    },
  };
}
