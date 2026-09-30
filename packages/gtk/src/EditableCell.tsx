// A cell that edits in place, on GTK. Which editor a field gets, the text
// an edit starts from and what saving does come from table-ui's shared
// `cellEdit` (D42), as they do in the web views; the widgets are GTK's own:
// a check button, a drop-down of the choices, an entry.

import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import {
  GtkBox,
  GtkButton,
  GtkCheckButton,
  GtkDropDown,
  GtkEntry,
  GtkEventControllerFocus,
  GtkEventControllerKey,
  GtkGestureClick,
  GtkLabel,
} from "@gtkx/jsx/gtk";
import { enumOptions, type Field, type ParsedTable } from "@workspace.sh/table-core";
import { type GridEditEnd, commitDraft, currencySymbolOf, draftOf, editorKind, relatesMany, relationOptions, relationToggled, useDisplaySettings, EMPTY_TEXT } from "@workspace.sh/table-ui/shared";
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
  /** Choose a file for an attachment cell (the app copies it in). Absent: its name is typed. */
  onAttach?: () => void;
  /**
   * Open the cell from the keyboard (the grid's Enter, or a character
   * typed on it): each new `n` opens it once, with `text` typed over what's
   * there when given.
   */
  editRequest?: { n: number; text?: string };
  /** Editing closed from the keyboard, and how: the grid moves on from it. */
  onEditEnd?: (how: GridEditEnd) => void;
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
  onClose: (how: GridEditEnd) => void;
  onCommit: (next: unknown) => void;
  /** The choices, when they aren't the field's own (a relation's rows). */
  choices?: { value: string; label?: string }[];
}) {
  const options = choices ?? enumOptions(field);
  const at = options.findIndex((o) => o.value === value) + 1;
  const labels = [EMPTY_TEXT, ...options.map((o) => o.label ?? o.value)];
  const ref = useSelected<Gtk.DropDown>(at, labels.join("\u0000"));
  return (
    <GtkDropDown
      ref={ref}
      hexpand
      selected={at}
      model={<StringList strings={labels} />}
      onNotifySelected={(index) => {
        if (index === null || index === at) return;
        onClose("done");
        const next = index === 0 ? null : options[index - 1]!.value;
        if (next !== value) onCommit(next);
      }}
      controllers={
        <>
          <GtkEventControllerFocus onLeave={() => onClose("done")} />
          <GtkEventControllerKey onKeyPressed={(keyval) => (keyval === Gdk.KEY_Escape ? (onClose("escape"), true) : false)} />
        </>
      }
    />
  );
}

export function EditableCell({ field, value, onCommit, relatedTables, onOpenRelation, lines, xalign = 0, autoEdit, onAttach, editRequest, onEditEnd }: EditableCellProps) {
  const kind = editorKind(field);
  const { locale } = useDisplaySettings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Why the typed text wasn't saved, and the date it probably meant.
  const [problem, setProblem] = useState<{ message: string; suggestion?: string } | null>(null);
  // The draft already asked about (an early year, D42): saved if saved again.
  const queried = useRef<string | null>(null);
  // Once saved or cancelled, the focus leaving as the entry goes away
  // mustn't save the draft again.
  const closed = useRef(false);
  const entry = useRef<Gtk.Entry | null>(null);
  // Typed over what was there: the cursor goes after it, not selecting it.
  const typedOver = useRef(false);

  const start = (text?: string) => {
    if (kind === "readonly") return;
    closed.current = false;
    queried.current = null;
    typedOver.current = text !== undefined;
    setDraft(text ?? draftOf(value));
    setProblem(null);
    setEditing(true);
  };

  // The grid's keyboard asking: an attachment chooses its file; the rest open.
  useEffect(() => {
    if (!editRequest) return;
    if (kind === "attachment" && onAttach) onAttach();
    else start(editRequest.text);
    // Once for each request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest?.n]);

  useEffect(() => {
    if (autoEdit) start();
    // Only as the cell first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the entry once it's there, with its text selected to type over.
  useEffect(() => {
    if (!editing || kind !== "text" || !entry.current) return;
    if (typedOver.current) {
      entry.current.grabFocusWithoutSelecting();
      entry.current.setPosition(-1);
    } else entry.current.grabFocus();
  }, [editing, kind]);

  const close = () => {
    closed.current = true;
    setEditing(false);
    setProblem(null);
  };

  /** Saved (or nothing to save) and closed: true; refused, the editor stays: false. */
  const commit = (raw: string, how: "key" | "blur"): boolean => {
    if (closed.current) return false;
    const result = commitDraft(field, value, raw, how, queried.current);
    if (result.kind === "problem") {
      queried.current = result.queried;
      setProblem({ message: result.check.message, suggestion: result.check.suggestion });
      return false;
    }
    close();
    if (result.kind === "save") onCommit(result.value);
    return true;
  };

  const shown = <CellValue field={field} value={value} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={lines} xalign={xalign} />;

  if (kind === "readonly") return shown;
  // An attachment: shown as it is, with a button that chooses the file.
  if (kind === "attachment" && onAttach) {
    return (
      <GtkBox hexpand spacing={4}>
        <GtkBox hexpand>{shown}</GtkBox>
        <GtkButton iconName="document-open-symbolic" cssClasses={["flat", "circular"]} valign={Gtk.Align.CENTER} tooltipText="Choose File" onClicked={onAttach} />
      </GtkBox>
    );
  }
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
        onClose={(how) => {
          close();
          onEditEnd?.(how);
        }}
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
        // Asks for no more than the column: GtkEntry's natural width is wider,
        // and a row box hands spare room out by natural width.
        widthChars={1}
        maxWidthChars={1}
        text={draft}
        xalign={xalign}
        cssClasses={problem ? ["error"] : []}
        // A year typed short: the icon is the fix, as the web's "Use 2026"
        // button is, inside the entry so the cell keeps its width.
        secondaryIconName={problem?.suggestion ? "object-select-symbolic" : problem ? "dialog-warning-symbolic" : undefined}
        secondaryIconTooltipText={problem?.suggestion ? `Use ${problem.suggestion.slice(0, 4)}` : problem?.message}
        secondaryIconActivatable={!!problem?.suggestion}
        onIconPress={(position) => {
          if (position === Gtk.EntryIconPosition.SECONDARY && problem?.suggestion) commit(problem.suggestion, "key");
        }}
        tooltipText={problem?.message}
        onChanged={(e) => {
          setDraft(e.getText());
          setProblem(null);
        }}
        onActivate={(e) => {
          if (commit(e.getText(), "key")) onEditEnd?.("enter");
        }}
        controllers={
          <>
            <GtkEventControllerKey
              propagationPhase={Gtk.PropagationPhase.CAPTURE}
              onKeyPressed={(keyval, _code, state) => {
                if (keyval === Gdk.KEY_Escape) {
                  close();
                  onEditEnd?.("escape");
                  return true;
                }
                // Tab saves and moves along, as in a spreadsheet, rather than leaving the table.
                if (keyval === Gdk.KEY_Tab || keyval === Gdk.KEY_ISO_Left_Tab) {
                  const back = keyval === Gdk.KEY_ISO_Left_Tab || (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
                  if (commit(entry.current?.getText() ?? draft, "key")) onEditEnd?.(back ? "shift-tab" : "tab");
                  return true;
                }
                return false;
              }}
            />
            <GtkEventControllerFocus onLeave={() => commit(entry.current?.getText() ?? draft, "blur")} />
          </>
        }
      />
    </GtkBox>
  );
}

