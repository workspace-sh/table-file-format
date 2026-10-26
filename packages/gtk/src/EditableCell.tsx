// A cell that edits in place, on GTK. Which editor a field gets, the text
// an edit starts from and what saving does come from table-ui's shared
// `cellEdit` (D42), as they do in the web views; the widgets are GTK's own:
// a check button, a drop-down of the choices, an entry.

import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import {
  GtkAdjustment,
  GtkBox,
  GtkButton,
  GtkCalendar,
  GtkCheckButton,
  GtkDropDown,
  GtkEntry,
  GtkEventControllerFocus,
  GtkEventControllerKey,
  GtkGestureClick,
  GtkLabel,
  GtkMenuButton,
  GtkPopover,
  GtkSignalListItemFactory,
  GtkSpinButton,
} from "@gtkx/jsx/gtk";
import { enumOptions, FormulaError, type Field, type ParsedTable } from "@workspace.sh/table-core";
import { pillClass, styles, useDark } from "./theme.js";
import { type GridEditEnd, inputHints, cellFormulaText, FORMULA_PREFIX, commitDraft, type CellFormulaEntry, currencySymbolOf, dateOfStored, draftOf, editorKind, localDate, storedOfDate, type DateKind, relatesMany, relationOptions, relationToggled, useDisplaySettings, EMPTY_TEXT } from "@workspace.sh/table-ui/shared";
import { useEffect, useRef, useState } from "react";
import { CellValue } from "./CellValue.js";
import { ListEditor } from "./ListEditor.js";
import { StringList } from "./StringList.js";
import { useSelected } from "./useSelected.js";
import { inputHintsOf, inputPurposeOf } from "./inputPurpose.js";

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
  /**
   * Typing `=…` gives the cell its own formula (D52): what that needs, the
   * formula it has now, and where it's saved. Absent: `=` is typed as text.
   */
  formula?: CellFormulaEntry & { syntax?: "excel" | "stored"; onSet: (expr: string) => void };
}

/**
 * A choice cell being edited: a drop-down of the field's choices, and "—"
 * for none. Picking one saves it; leaving or Escape closes without. A
 * field's own choices are drawn as the cell draws them, each a pill in its
 * colour; a relation's rows are plain names.
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
  const dark = useDark();
  const colors = choices ? null : [undefined, ...enumOptions(field).map((o) => o.color)];
  return (
    <GtkDropDown
      ref={ref}
      hexpand
      selected={at}
      model={<StringList strings={labels} />}
      {...(colors
        ? {
            factory: (
              <GtkSignalListItemFactory
                onSetup={(object) => {
                  const label = new Gtk.Label();
                  label.setHalign(Gtk.Align.START);
                  (object as Gtk.ListItem).setChild(label);
                }}
                onBind={(object) => {
                  const item = object as Gtk.ListItem;
                  const i = item.getPosition();
                  const label = item.getChild() as Gtk.Label;
                  label.setLabel(labels[i] ?? "");
                  // "—", for none, is no choice, so no pill.
                  label.setCssClasses(i === 0 ? [] : [styles.pill, pillClass(colors[i], dark)]);
                }}
              />
            ),
          }
        : {})}
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

/** A picker's words and picture, by what it picks. */
const PICKERS: Record<DateKind, { tooltip: string; icon: string }> = {
  date: { tooltip: "Choose a Date", icon: "x-office-calendar-symbolic" },
  datetime: { tooltip: "Choose a Date and Time", icon: "x-office-calendar-symbolic" },
  time: { tooltip: "Choose a Time", icon: "preferences-system-time-symbolic" },
};

export function EditableCell({ field, value, onCommit, relatedTables, onOpenRelation, lines, xalign = 0, autoEdit, onAttach, editRequest, onEditEnd, formula }: EditableCellProps) {
  const kind = editorKind(field);
  const { locale } = useDisplaySettings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Editing the cell's own formula (D52): its `=` is drawn before the entry, not in it, and put back on saving.
  const [asFormula, setAsFormula] = useState(false);
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
  // A date or a time is also picked: a day from a calendar, an hour and minute from two spinners, as the
  // field has them. While the picker is open the entry losing the keyboard isn't the edit ending; what is
  // picked goes into the entry as the cell stores it (table-ui's storedOfDate, as the phone's picker
  // writes it: a date and time in UTC, shown here in the viewer's own time), and closing the picker saves it.
  const dateKind: DateKind | null = field?.type === "date" || field?.type === "datetime" || field?.type === "time" ? field.type : null;
  const dated = dateKind !== null;
  const picking = useRef(false);
  const draftNow = useRef(draft);
  draftNow.current = draft;
  const calendarButton = useRef<Gtk.MenuButton | null>(null);
  // What the draft names, in the viewer's time: nothing while it names none.
  const drafted = dateKind ? dateOfStored(dateKind, draft) : null;
  // The keyboard leaving a date's entry isn't the edit ending when it has only gone to the
  // picker's button, or the picker is open: looked at once the move is over.
  const leftSoon = () =>
    setTimeout(() => {
      if (picking.current || closed.current) return;
      const within = (widget: Gtk.Widget | null, of: Gtk.Widget | null) => {
        for (let w = widget; w && of; w = w.getParent()) if (w === of) return true;
        return false;
      };
      const focus = (entry.current?.getRoot() as Gtk.Window | null | undefined)?.getFocus() ?? null;
      if (within(focus, entry.current) || within(focus, calendarButton.current)) return;
      commit(entry.current?.getText() ?? draftNow.current, "blur");
    }, 0);
  /** One part picked: the draft becomes what it named with that part changed. A draft that names nothing yet starts from now, to the minute. */
  const pick = (change: (from: Date) => Date) => {
    if (!dateKind) return;
    const now = new Date();
    now.setSeconds(0, 0);
    setDraft(storedOfDate(dateKind, change(dateOfStored(dateKind, draftNow.current) ?? now)));
    setProblem(null);
  };
  const pickDay = (calendar: Gtk.Calendar) => {
    const day = calendar.getDate();
    pick((from) => localDate(day.getYear(), day.getMonth() - 1, day.getDayOfMonth(), from.getHours(), from.getMinutes(), from.getSeconds()));
  };
  // A calendar says a day was chosen only when the day's number changes. So the same number in
  // another month (paged to, or chosen there) and today's own day in an empty field say nothing,
  // and are heard another way: the month or the year moving, and a press on the calendar.
  const calendar = useRef<Gtk.Calendar | null>(null);
  /** The calendar's day as the draft would have it, or that the draft already names it (the calendar only followed what was typed). */
  const followCalendar = () =>
    setTimeout(() => {
      const shown = calendar.current;
      if (!shown || !dateKind || closed.current) return;
      const day = shown.getDate();
      const named = dateOfStored(dateKind, draftNow.current);
      if (named && named.getFullYear() === day.getYear() && named.getMonth() === day.getMonth() - 1 && named.getDate() === day.getDayOfMonth()) return;
      pickDay(shown);
    }, 0);
  const pickTime = (part: "hours" | "minutes", value: number) =>
    pick((from) => {
      const to = new Date(from.getTime());
      if (part === "hours") to.setHours(value);
      else to.setMinutes(value);
      return to;
    });

  const start = (text?: string) => {
    if (kind === "readonly") return;
    closed.current = false;
    queried.current = null;
    typedOver.current = text !== undefined;
    // A cell with its own formula is edited as that formula (D52), in the reader's syntax, its `=` before the entry.
    const own = text === undefined && formula?.own !== undefined;
    setAsFormula(own);
    setDraft(text ?? (own ? cellFormulaText(formula!.own!, formula!.grid, formula!.syntax) : draftOf(value)));
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
    const result = commitDraft(field, value, asFormula ? FORMULA_PREFIX + raw : raw, how, queried.current, formula);
    if (result.kind === "problem") {
      queried.current = result.queried;
      setProblem({ message: result.check.message, suggestion: result.check.suggestion });
      return false;
    }
    close();
    if (result.kind === "save") onCommit(result.value);
    if (result.kind === "formula") formula?.onSet(result.expr);
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

  // A formula that failed shows why, not an unticked box.
  if (kind === "boolean" && !(value instanceof FormulaError)) {
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
      {asFormula ? <GtkLabel name="formula-prefix" label={FORMULA_PREFIX} cssClasses={["dim-label"]} /> : symbol ? <GtkLabel label={symbol} cssClasses={["dim-label"]} /> : null}
      <GtkEntry
        ref={entry}
        hexpand
        // Asks for no more than the column: GtkEntry's natural width is wider,
        // and a row box hands spare room out by natural width.
        widthChars={1}
        maxWidthChars={1}
        // What the column takes, for an on-screen keyboard (table-ui/shared's inputHints).
        inputPurpose={inputPurposeOf(inputHints(field))}
        inputHints={inputHintsOf(inputHints(field))}
        text={draft}
        xalign={xalign}
        // The cell's own ring is the editor's frame, as on the web: the entry draws none of its own.
        cssClasses={[styles.cellEntry, ...(problem ? ["error"] : [])]}
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
                // Backspace before the formula's first character takes its `=`: what's left is a value (D52).
                if (keyval === Gdk.KEY_BackSpace && asFormula && entry.current?.getPosition() === 0 && !entry.current.getSelectionBounds()[0]) {
                  setAsFormula(false);
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
            <GtkEventControllerFocus onLeave={() => (dated ? leftSoon() : commit(entry.current?.getText() ?? draft, "blur"))} />
          </>
        }
      />
      {dateKind ? (
        <GtkMenuButton
          ref={calendarButton}
          controllers={<GtkEventControllerFocus onLeave={leftSoon} />}
          iconName={PICKERS[dateKind].icon}
          cssClasses={["flat", "circular"]}
          valign={Gtk.Align.CENTER}
          tooltipText={PICKERS[dateKind].tooltip}
          onNotifyActive={(active) => {
            if (active) picking.current = true;
          }}
          popover={
            <GtkPopover
              onClosed={() => {
                if (!picking.current) return;
                picking.current = false;
                // The picker closed: what was picked is saved, or the entry has the keyboard again to put it right.
                if (!commit(draftNow.current, "key")) entry.current?.grabFocus();
                else onEditEnd?.("escape");
              }}
            >
              <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                {dateKind !== "time" ? (
                  <GtkCalendar
                    ref={calendar}
                    {...(drafted ? { year: drafted.getFullYear(), month: drafted.getMonth(), day: drafted.getDate() } : {})}
                    onDaySelected={pickDay}
                    onNotifyMonth={followCalendar}
                    onNotifyYear={followCalendar}
                    // A press on the day already shown (today's, in an empty field) changes nothing the calendar would say.
                    controllers={<GtkGestureClick name="pick-shown-day" propagationPhase={Gtk.PropagationPhase.CAPTURE} onPressed={followCalendar} />}
                  />
                ) : null}
                {dateKind !== "date" ? (
                  <GtkBox spacing={6} halign={Gtk.Align.CENTER}>
                    <GtkSpinButton
                      tooltipText="Hour"
                      numeric
                      wrap
                      widthChars={2}
                      adjustment={<GtkAdjustment lower={0} upper={23} stepIncrement={1} pageIncrement={6} value={drafted?.getHours() ?? 0} />}
                      onValueChanged={(self) => pickTime("hours", self.getValueAsInt())}
                    />
                    <GtkLabel label=":" />
                    <GtkSpinButton
                      tooltipText="Minute"
                      numeric
                      wrap
                      widthChars={2}
                      adjustment={<GtkAdjustment lower={0} upper={59} stepIncrement={1} pageIncrement={10} value={drafted?.getMinutes() ?? 0} />}
                      onValueChanged={(self) => pickTime("minutes", self.getValueAsInt())}
                    />
                  </GtkBox>
                ) : null}
              </GtkBox>
            </GtkPopover>
          }
        />
      ) : null}
    </GtkBox>
  );
}

