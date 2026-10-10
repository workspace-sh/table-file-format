// The Mac's settings forms, for table-ui's Sheet and SettingsForm slots:
// a field's settings, a new field, and the view's settings are described
// by table-ui as sections of rows, which the inspector draws as the
// system's own form (native/TablePanels/TableSettingsForm.swift), as the
// iOS app does with SwiftUI's. Nothing is drawn here: the form on screen
// is sent to the inspector, and what's done in it comes back by row.

import { createContext, useContext, useEffect, useId, useRef, type ReactElement } from "react";
import type { SettingsFormProps, SettingsRow, SettingsSection, SheetProps, SheetSlot } from "@workspace.sh/table-ui/shared";
import { setInspectorShown, setSettingsForm, type SettingsFormEvent } from "./nativeSidebar";

type SheetFacts = Pick<SheetProps, "title" | "cancel" | "confirm" | "onDismiss">;

/** The sheet a settings form is in: its title and its buttons. */
const SheetContext = createContext<SheetFacts | null>(null);

// The form on screen: whose it is, and what its rows and buttons do.
let shown: { owner: string; sections: SettingsSection[]; sheet: SheetFacts } | null = null;

/** A row as the inspector reads it: its words and values, without what it does. */
function plain(row: SettingsRow): object {
  switch (row.kind) {
    case "text":
      return { kind: row.kind, id: row.id, label: row.label, value: row.value, placeholder: row.placeholder, autoFocus: row.autoFocus, submits: !!row.onSubmit };
    case "info":
      return { kind: row.kind, id: row.id, label: row.label, value: row.value };
    case "choice":
      return { kind: row.kind, id: row.id, label: row.label, value: row.value, options: row.options, style: row.style };
    case "toggle":
      return { kind: row.kind, id: row.id, label: row.label, on: row.value };
    case "compound":
      return { kind: row.kind, id: row.id, parts: row.parts.map(plain) };
    case "action":
      return { kind: row.kind, id: row.id, label: row.label, role: row.role, disabled: row.disabled };
  }
}

function find(rows: SettingsRow[], id: string): SettingsRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row;
    if (row.kind === "compound") {
      const part = find(row.parts, id);
      if (part) return part;
    }
  }
  return undefined;
}

/** What was done in the inspector's form, handed to the row it was done to. */
export function onSettingsFormEvent(e: SettingsFormEvent): void {
  if (!shown) return;
  const { sections, sheet } = shown;
  if (e.what === "cancel") return sheet.cancel?.onPress();
  if (e.what === "confirm") return sheet.confirm?.onPress();
  if (e.what === "remove" || e.what === "move") {
    const section = sections.find((s) => s.id === e.section);
    if (e.what === "remove" && e.index !== undefined) section?.onRemove?.(e.index);
    else if (e.what === "move" && e.from !== undefined && e.to !== undefined) section?.onMove?.(e.from, e.to);
    return;
  }
  const row = e.id === undefined ? undefined : sections.map((s) => find(s.rows, e.id!)).find(Boolean);
  if (!row) return;
  if (row.kind === "text" && e.what === "change") row.onChange(String(e.value ?? ""));
  else if (row.kind === "text" && e.what === "submit") row.onSubmit?.(String(e.value ?? ""));
  else if (row.kind === "choice" && e.what === "change") row.onChange(String(e.value ?? ""));
  else if (row.kind === "toggle" && e.what === "toggle") row.onChange(e.value === true);
  else if (row.kind === "action" && e.what === "press") row.onPress();
}

/** The inspector was closed with a settings form in it: the form is dismissed, as a tap outside a sheet does. */
export function dismissSettingsForm(): void {
  shown?.sheet.onDismiss();
}

/** Whether a settings form is in the inspector. */
export function settingsFormShown(): boolean {
  return shown !== null;
}

/** Development only: the form on screen as the inspector was sent it. */
export function settingsFormJson(): string | null {
  return shown ? json(shown.owner, shown.sections, shown.sheet) : null;
}

function json(owner: string, sections: SettingsSection[], sheet: SheetFacts): string {
  return JSON.stringify({
    key: owner,
    title: sheet.title,
    cancel: sheet.cancel?.label,
    confirm: sheet.confirm?.label,
    confirmDisabled: sheet.confirm?.disabled,
    removeLabel: "Remove",
    moveUpLabel: "Move Up",
    moveDownLabel: "Move Down",
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      footer: s.footer,
      rows: s.rows.map(plain),
      removable: !!s.onRemove,
      movable: !!s.onMove,
    })),
  });
}

/** table-ui's SettingsForm slot: the sections go to the inspector's form. */
function SettingsFormView({ sections }: SettingsFormProps): ReactElement {
  const owner = useId();
  const sheet = useContext(SheetContext);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet) return;
    // What the rows do is read at the time something is done, from the latest render.
    shown = { owner, sections, sheet };
    const next = json(owner, sections, sheet);
    if (next !== sent.current) {
      sent.current = next;
      setSettingsForm(next);
    }
  });
  useEffect(() => {
    setInspectorShown(true);
    return () => {
      // Unless another form has taken its place since.
      if (shown?.owner === owner) {
        shown = null;
        setSettingsForm(null);
      }
    };
  }, [owner]);
  return <></>;
}

export const MacSettingsForm = Object.assign(SettingsFormView, { reorderHint: "Use a sort’s menu to reorder." });

/**
 * table-ui's Sheet slot for a Mac window: settings are the inspector's
 * form, with the sheet's title and buttons, so there is nothing of its own
 * to draw for them; anything else (a row's page) is `Page`'s to present.
 */
export function macSheet(Page: (props: SheetProps) => ReactElement): SheetSlot {
  function MacSheet(props: SheetProps): ReactElement {
    if (props.size !== "settings") return <Page {...props} />;
    const { title, cancel, confirm, onDismiss, children } = props;
    return <SheetContext.Provider value={{ title, cancel, confirm, onDismiss }}>{children}</SheetContext.Provider>;
  }
  return Object.assign(MacSheet, { presentsSettings: true });
}
