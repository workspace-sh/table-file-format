// A list cell's editors on GTK, as table-ui's ListCell on the web: a
// multi-select is its pills in a button whose popover ticks choices on and
// off; a plain list is typed as "a, b, c". What a toggle or typed text
// stores comes from table-ui/shared's cellEdit (listToggled, listFromText).

import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkCheckButton, GtkEntry, GtkEventControllerFocus, GtkEventControllerKey, GtkGestureClick, GtkMenuButton, GtkPopover } from "@gtkx/jsx/gtk";
import { enumOptions, type Field, type ParsedTable } from "@workspace.sh/table-core";
import { listFromText, listItems, listText, listToggled } from "@workspace.sh/table-ui/shared";
import { useEffect, useRef, useState } from "react";
import { CellValue } from "./CellValue.js";

interface ListEditorProps {
  field: Field | undefined;
  value: unknown;
  onCommit: (next: unknown) => void;
  /** The choices, when they aren't the field's own (a relation's rows). */
  choices?: { value: string; label?: string }[];
  /** The value with a choice toggled, when that isn't listToggled's (a relation keeps its table's order). */
  toggled?: (choice: string) => unknown;
  relatedTables?: Record<string, ParsedTable>;
  /** A related row's link, opened: shown as links, as a relation cell is. */
  onOpenRelation?: (address: string) => void;
  lines?: number;
  xalign?: number;
}

/** A multi-select: its pills in a flat button; the popover ticks each choice on or off, saving as it goes. */
function ChoicesList({ field, value, onCommit, relatedTables, onOpenRelation, lines, xalign, choices, toggled }: ListEditorProps) {
  const items = listItems(value);
  const options = choices ?? enumOptions(field);
  return (
    <GtkMenuButton
      hexpand
      cssClasses={["flat"]}
      // Its name for assistive technology: the button's own content is the pills.
      accessibleLabel={`Choose ${field?.title ?? field?.name ?? ""}`.trim()}
      tooltipText="Choose"
      popover={
        <GtkPopover>
          <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={2} marginTop={4} marginBottom={4} marginStart={4} marginEnd={4}>
            {options.map((o) => (
              <GtkCheckButton
                key={o.value}
                label={o.label ?? o.value}
                active={items.includes(o.value)}
                onToggled={(b) => {
                  if (b.getActive() !== items.includes(o.value)) onCommit(toggled ? toggled(o.value) : listToggled(field, value, o.value));
                }}
              />
            ))}
          </GtkBox>
        </GtkPopover>
      }
    >
      <CellValue field={field} value={value} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={lines} xalign={xalign} />
    </GtkMenuButton>
  );
}

/** A plain list: a click types it as "a, b, c"; Enter or leaving saves, Escape doesn't. */
function TypedList({ field, value, onCommit, relatedTables, lines, xalign }: ListEditorProps) {
  const [editing, setEditing] = useState(false);
  const entry = useRef<Gtk.Entry | null>(null);
  const closed = useRef(false);
  useEffect(() => {
    if (editing) entry.current?.grabFocus();
  }, [editing]);
  const commit = (text: string) => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    const next = listFromText(text);
    if (listText(next) !== listText(value)) onCommit(next);
  };
  if (!editing) {
    return (
      <GtkBox
        hexpand
        controllers={
          <GtkGestureClick
            onReleased={() => {
              closed.current = false;
              setEditing(true);
            }}
          />
        }
      >
        <CellValue field={field} value={value} relatedTables={relatedTables} lines={lines} xalign={xalign} />
      </GtkBox>
    );
  }
  return (
    <GtkEntry
      ref={entry}
      hexpand
      widthChars={1}
      maxWidthChars={1}
      text={listText(value)}
      placeholderText="a, b, c"
      onActivate={(e) => commit(e.getText())}
      controllers={
        <>
          <GtkEventControllerKey
            propagationPhase={Gtk.PropagationPhase.CAPTURE}
            onKeyPressed={(keyval) => {
              if (keyval !== Gdk.KEY_Escape) return false;
              closed.current = true;
              setEditing(false);
              return true;
            }}
          />
          <GtkEventControllerFocus onLeave={() => commit(entry.current?.getText() ?? "")} />
        </>
      }
    />
  );
}

/** A list cell's editor: a multi-select's popover, or a typed list. */
export function ListEditor(props: ListEditorProps) {
  return props.choices || enumOptions(props.field).length > 0 ? <ChoicesList {...props} /> : <TypedList {...props} />;
}
