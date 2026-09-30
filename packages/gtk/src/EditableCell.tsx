// A cell that edits in place, on GTK. Which editor a field gets, the text
// an edit starts from and what saving does come from table-ui's shared
// `cellEdit` (D42), as they do in the web views; the widgets are GTK's own:
// a check button, a drop-down of the choices, an entry.

import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import {
  GtkBox,
  GtkCheckButton,
  GtkDropDown,
  GtkEntry,
  GtkEventControllerFocus,
  GtkEventControllerKey,
  GtkGestureClick,
  GtkLabel,
} from "@gtkx/jsx/gtk";
import { enumOptions, type Field, type ParsedTable } from "@workspace.sh/table-core";
import { commitDraft, currencySymbolOf, draftOf, editorKind, relatesMany, relationOptions, relationToggled, useDisplaySettings } from "@workspace.sh/table-ui/shared";
import { useEffect, useRef, useState } from "react";
import { CellValue } from "./CellValue.js";
import { ListEditor } from "./ListEditor.js";
import { StringList } from "./StringList.js";
import { useSelected } from "./useSelected.js";

export interface EditableCellProps {
  field: Field | undefined;
  value: unknown;
  onCommit: (next: unknown) => void;
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
  lines?: number;
  xalign?: number;
  /** Open for typing as it first appears: a row just added. */
  autoEdit?: boolean;
}

/**
 * A choice cell being edited: a drop-down of the field's choices, and "—"
 * for none. Picking one saves it; leaving or Escape closes without.
 */
function ChoiceEditor({
  field,
  value,
  onClose,
  onCommit,
  choices,
}: {
  field: Field | undefined;
  value: unknown;
  onClose: () => void;
  onCommit: (next: unknown) => void;
  /** The choices, when they aren't the field's own (a relation's rows). */
  choices?: { value: string; label?: string }[];
}) {
  const options = choices ?? enumOptions(field);
  const at = options.findIndex((o) => o.value === value) + 1;
  const labels = ["—", ...options.map((o) => o.label ?? o.value)];
  const ref = useSelected<Gtk.DropDown>(at, labels.join("\u0000"));
  return (
    <GtkDropDown
      ref={ref}
      hexpand
      selected={at}
      model={<StringList strings={labels} />}
      onNotifySelected={(index) => {
        if (index === null || index === at) return;
        onClose();
        const next = index === 0 ? null : options[index - 1]!.value;
        if (next !== value) onCommit(next);
      }}
      controllers={
        <>
          <GtkEventControllerFocus onLeave={onClose} />
          <GtkEventControllerKey onKeyPressed={(keyval) => (keyval === Gdk.KEY_Escape ? (onClose(), true) : false)} />
        </>
      }
    />
  );
}

export function EditableCell({ field, value, onCommit, relatedTables, onOpenRelation, lines, xalign = 0, autoEdit }: EditableCellProps) {
  const kind = editorKind(field);
  const { locale } = useDisplaySettings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // The draft already asked about (an early year, D42): saved if saved again.
  const queried = useRef<string | null>(null);
  // Once saved or cancelled, the focus leaving as the entry goes away
  // mustn't save the draft again.
  const closed = useRef(false);
  const entry = useRef<Gtk.Entry | null>(null);

  const start = () => {
    if (kind === "readonly") return;
    closed.current = false;
    queried.current = null;
    setDraft(draftOf(value));
    setProblem(null);
    setEditing(true);
  };

  useEffect(() => {
    if (autoEdit) start();
    // Only as the cell first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the entry once it's there, with its text selected to type over.
  useEffect(() => {
    if (editing && kind === "text") entry.current?.grabFocus();
  }, [editing, kind]);

  const close = () => {
    closed.current = true;
    setEditing(false);
    setProblem(null);
  };

  const commit = (raw: string, how: "key" | "blur") => {
    if (closed.current) return;
    const result = commitDraft(field, value, raw, how, queried.current);
    if (result.kind === "problem") {
      queried.current = result.queried;
      setProblem(result.check.suggestion ? `${result.check.message} Did you mean ${result.check.suggestion}?` : result.check.message);
      return;
    }
    close();
    if (result.kind === "save") onCommit(result.value);
  };

  const shown = <CellValue field={field} value={value} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={lines} xalign={xalign} />;

  if (kind === "readonly") return shown;
  if (kind === "list") return <ListEditor field={field} value={value} onCommit={onCommit} relatedTables={relatedTables} lines={lines} xalign={xalign} />;
  // A relation to many rows is ticked on and off, as a multi-select is.
  if (kind === "relation" && relatesMany(field)) {
    return (
      <ListEditor
        field={field}
        value={value}
        onCommit={onCommit}
        relatedTables={relatedTables}
        lines={lines}
        xalign={xalign}
        choices={relationOptions(field, relatedTables)}
        toggled={(id) => relationToggled(field, value, id, relatedTables)}
        onOpenRelation={onOpenRelation}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <GtkCheckButton
        active={value === true}
        halign={xalign === 0.5 ? Gtk.Align.CENTER : xalign === 1 ? Gtk.Align.END : Gtk.Align.START}
        hexpand
        tooltipText={field?.title ?? field?.name}
        onToggled={(button) => {
          if (button.getActive() !== (value === true)) onCommit(button.getActive());
        }}
      />
    );
  }

  if (!editing) {
    // A click edits: the cell is the control, as a spreadsheet's is.
    return (
      <GtkBox hexpand controllers={<GtkGestureClick onReleased={() => start()} />}>
        {shown}
      </GtkBox>
    );
  }

  // A relation to one row is picked the same way, from the related table's rows.
  if (kind === "choice" || kind === "relation") {
    return (
      <ChoiceEditor
        field={field}
        value={value}
        onClose={close}
        onCommit={onCommit}
        choices={kind === "relation" ? relationOptions(field, relatedTables) : undefined}
      />
    );
  }

  const symbol = currencySymbolOf(field, locale);
  return (
    <GtkBox hexpand spacing={4}>
      {symbol ? <GtkLabel label={symbol} cssClasses={["dim-label"]} /> : null}
      <GtkEntry
        ref={entry}
        hexpand
        widthChars={1}
        text={draft}
        xalign={xalign}
        cssClasses={problem ? ["error"] : []}
        secondaryIconName={problem ? "dialog-warning-symbolic" : undefined}
        secondaryIconTooltipText={problem ?? undefined}
        tooltipText={problem ?? undefined}
        onChanged={(e) => {
          setDraft(e.getText());
          setProblem(null);
        }}
        onActivate={(e) => commit(e.getText(), "key")}
        controllers={
          <>
            <GtkEventControllerKey
              propagationPhase={Gtk.PropagationPhase.CAPTURE}
              onKeyPressed={(keyval) => {
                if (keyval !== Gdk.KEY_Escape) return false;
                close();
                return true;
              }}
            />
            <GtkEventControllerFocus onLeave={() => commit(entry.current?.getText() ?? draft, "blur")} />
          </>
        }
      />
    </GtkBox>
  );
}

