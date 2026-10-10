// A formula being written goes to the inspector's own editor
// (TableFormulaEditor.swift): the system's text view in the system's form.
// This is its other half: glass-bar's editor state (the one the iOS bar
// shows) said as the editor reads it, and what's typed or pressed there
// handed back to the same callbacks.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { GlassBarHandle, GlassBarProps } from "@workspace.sh/glass-bar";
import { insertInFormula, setFormulaEditor, type FormulaEditorEvent, type FormulaEditorShown } from "./nativeSidebar";

let handle: (event: FormulaEditorEvent) => void = () => {};

/** What was typed or pressed in the editor, from the native side. */
export function onFormulaEditorEvent(event: FormulaEditorEvent): void {
  handle(event);
}

let shownJson: string | null = null;
/** Development only: what the editor is showing, as sent. */
export const formulaEditorJson = (): string | null => shownJson;

/**
 * Shows the formula `props` is editing in the inspector while `on`, and
 * gives `bar` the editor's insert (a clicked column's name goes in at the
 * cursor).
 */
export function useMacFormulaEditor(props: GlassBarProps, bar: RefObject<GlassBarHandle | null>, on: boolean): void {
  const editing = on && props.state.kind === "editing" ? props.state : null;
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
      } satisfies FormulaEditorShown)
    : null;
  shownJson = json;
  useEffect(() => {
    setFormulaEditor(json ? (JSON.parse(json) as FormulaEditorShown) : null);
  }, [json]);
  useEffect(() => () => setFormulaEditor(null), []);

  const latest = useRef({ props, editing });
  latest.current = { props, editing };
  useEffect(() => {
    handle = (event) => {
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
    };
    return () => {
      handle = () => {};
    };
  }, []);

  const isEditing = editing !== null;
  useEffect(() => {
    bar.current = isEditing ? { insert: insertInFormula } : null;
  }, [bar, isEditing]);
}
