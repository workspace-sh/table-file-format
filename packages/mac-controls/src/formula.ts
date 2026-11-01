// A formula being written goes to the inspector's own editor
// (macos/TableFormulaEditor.swift): the system's text view in the system's
// form, with the formula's colours, its working and its chips, as the .table
// app has it. Its state is glass-bar's (the one the iPhone's bar shows); what's
// typed or pressed there comes back to the same callbacks. Everything else is
// edited in its cell, as a Mac expects, so only formulas are taken over.
//
// An app gives each table's views the editor this returns (CellEditorContext).
// Several can be on screen (a document's embeds): the one writing a formula
// owns the inspector's editor until it stops.
import { useEffect, useRef, useState } from "react";
import { useGlassEditor, type GlassBarHandle, type GlassBarProps } from "@workspace.sh/glass-bar";
import { insertInFormula, onFormulaEditor, setFormulaEditor } from "./native";

/** What the inspector's formula editor reports: the text changed; Return (`submit`); a chip, the fix, Field Settings, Cancel or Save pressed. */
interface FormulaEditorEvent {
  what: "change" | "submit" | "save" | "cancel" | "fix" | "chip" | "settings";
  text?: string;
  id?: string;
}

// The table writing a formula now, which hears the editor's events.
let active: { handle: (event: FormulaEditorEvent) => void } | null = null;
let listening: (() => void) | null = null;
function listen(): void {
  if (listening) return;
  listening = onFormulaEditor<FormulaEditorEvent>((event) => active?.handle(event));
}

/**
 * The cell editor for a table's views on the Mac: formulas are written in
 * the inspector. Give it to CellEditorContext around the views.
 */
export function useMacFormulaEditing(): ReturnType<typeof useGlassEditor>["editor"] {
  const glass = useGlassEditor({ query: "", onQuery: () => {}, onFilter: () => {}, formulasOnly: true });
  useMacFormulaEditor(glass.props, glass.bar);
  return glass.editor;
}

function useMacFormulaEditor(props: GlassBarProps, bar: { current: GlassBarHandle | null }): void {
  const editing = props.state.kind === "editing" ? props.state : null;
  // What's in the field, once typed in: the colours and the working are for this text.
  const [typed, setTyped] = useState<{ key: string; text: string } | null>(null);
  const text = editing ? (typed?.key === editing.editKey ? typed.text : editing.initialValue) : "";
  const json = editing
    ? JSON.stringify({
        key: editing.editKey,
        label: editing.label,
        ...(editing.detail !== undefined ? { detail: editing.detail } : {}),
        initialValue: editing.initialValue,
        text,
        spans: editing.highlight?.(text) ?? [],
        working: editing.working?.sections ?? [],
        chips: (editing.chips ?? []).map(({ id, label, insert, cursorBack }) => ({ id, label, insert, cursorBack })),
        ...(editing.error ? { error: editing.error } : {}),
        cancelLabel: "Cancel",
        saveLabel: "Save for Every Row",
        ...(props.onFieldSettings ? { settingsLabel: "Field Settings…" } : {}),
      })
    : null;

  const latest = useRef({ props, editing });
  latest.current = { props, editing };
  const me = useRef({
    handle: (event: FormulaEditorEvent) => {
      const { props: now, editing: edit } = latest.current;
      if (!edit) return;
      if (event.what === "change") {
        const next = event.text ?? "";
        setTyped({ key: edit.editKey, text: next });
        now.onChange?.(next);
      } else if (event.what === "submit") now.onSubmit?.(event.text ?? "");
      else if (event.what === "save") now.onSave?.(event.text ?? "");
      else if (event.what === "cancel") now.onCancel?.();
      else if (event.what === "fix") now.onFix?.();
      else if (event.what === "chip" && event.id !== undefined) now.onChip?.(event.id);
      else if (event.what === "settings") now.onFieldSettings?.();
    },
  });

  useEffect(() => {
    listen();
    if (json) {
      active = me.current;
      setFormulaEditor(json);
    } else if (active === me.current) {
      active = null;
      setFormulaEditor("");
    }
  }, [json]);
  useEffect(
    () => () => {
      if (active === me.current) {
        active = null;
        setFormulaEditor("");
      }
    },
    [],
  );

  const isEditing = editing !== null;
  useEffect(() => {
    bar.current = isEditing ? { insert: insertInFormula } : null;
  }, [bar, isEditing]);
}
