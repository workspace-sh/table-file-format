// The calendar on GTK: a month of bars, a week of days over an hourly grid,
// or an agenda, with the rows that have no date under it. What goes where,
// and what a move or a resize writes, is table-ui's calendar module, the
// code the web, the Mac and a phone run; only the drawing is here. The
// columns are a homogeneous grid's, so they follow the pane as it changes
// width (a sidebar closing) with nothing measured.

import * as Adw from "@gtkx/gi/adw";
import * as Gdk from "@gtkx/gi/gdk";
import * as GObject from "@gtkx/gi/gobject";
import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { css } from "@gtkx/css";
import { AdwBreakpoint, AdwBreakpointBin, AdwDialog, AdwHeaderBar, AdwStatusPage, AdwToggle, AdwToggleGroup, AdwToolbarView, AdwWrapBox } from "@gtkx/jsx/adw";
import {
  GtkBox,
  GtkButton,
  GtkCalendar,
  GtkDragSource,
  GtkDropTarget,
  GtkGestureClick,
  GtkGrid,
  GtkImage,
  GtkGridLayoutChild,
  GtkLabel,
  GtkListBox,
  GtkListBoxRow,
  GtkMenuButton,
  GtkPopover,
  GtkScrolledWindow,
  GtkToggleButton,
} from "@gtkx/jsx/gtk";
import type { Row } from "@workspace.sh/table-core";
import {
  agendaDays,
  calendarBounds,
  calendarDate,
  calendarEntries,
  dateKey,
  daysBetween,
  dayTimeline,
  entriesOn,
  firstDayOfWeek,
  hiddenOnDay,
  hourWindow,
  initialMonth,
  isTimed,
  localDay,
  monthGrid,
  monthNameLong,
  moveEntry,
  resizeEntry,
  retimeEntry,
  rotateWeekdays,
  rowTitle,
  setCalendarRange,
  stepRange,
  useCalendarRange,
  useDisplaySettings,
  weekDays,
  weekdayNamesShort,
  weekSegments,
  type CalendarEntry,
  type CalendarRangeName,
  type ViewProps,
  type WeekSegment,
} from "@workspace.sh/table-ui/shared";
import { useRef, useState, type ReactNode } from "react";
import { scrollerHeight, useEmbedded, viewMargins } from "./embedded.js";
import { useRowColors } from "./rowColors.js";
import { styles, tintClass, useDark } from "./theme.js";

/** Each choice colour at full strength, for the small marks a calendar draws: the web's and the Mac's. */
const MARKS: Record<string, string> = {
  gray: "#8e8e93", brown: "#a2845e", red: "#ff3b30", orange: "#ff9500", yellow: "#ffcc00", lime: "#9fc92d", green: "#34c759",
  mint: "#00c7be", teal: "#30b0c7", cyan: "#32ade6", blue: "#007aff", indigo: "#5856d6", purple: "#af52de", pink: "#ff2d55",
};
const markClasses = new Map<string, string>();
function markClass(color: string | undefined): string {
  const mark = MARKS[color ?? "blue"] ?? MARKS.blue!;
  let name = markClasses.get(mark);
  if (name === undefined) {
    name = css({ backgroundColor: mark });
    markClasses.set(mark, name);
  }
  return name;
}

/** A month's week: its day's number, then this many lines of bars, then "+n more". */
const MONTH_LANES = 3;
const LANE = 22;
const WEEK_HEIGHT = 112;
/** An hour of a week's grid, and the gutter its times are in. */
const HOUR = 44;
const GUTTER = 52;
const SLOTS_PER_HOUR = 4;

/** What a drag carries: the row's id, and whether it's the entry's end. */
const DRAGGED = GObject.typeFromName("gchararray");
const carried = (id: string, end: boolean) => `${end ? "end" : "move"}:${id}`;
function heard(value: string | null): { id: string; end: boolean } | null {
  if (!value) return null;
  const at = value.indexOf(":");
  return at < 0 ? null : { id: value.slice(at + 1), end: value.slice(0, at) === "end" };
}

function dragOf(id: string, end = false) {
  return <GtkDragSource actions={Gdk.DragAction.MOVE} onPrepare={() => Gdk.ContentProvider.newForValue(carried(id, end))} />;
}

function dropOn(onDrop: (what: { id: string; end: boolean }, x: number, y: number, width: number) => void) {
  return (
    <GtkDropTarget
      types={[DRAGGED]}
      actions={Gdk.DragAction.MOVE}
      onDrop={(value: GObject.Value, x: number, y: number, self: Gtk.DropTarget) => {
        const what = heard(value.getString());
        if (!what) return false;
        onDrop(what, x, y, self.getWidget()?.getWidth() ?? 0);
        return true;
      }}
    />
  );
}

/** A title that ends in "…" rather than widening the column it's in. */
function Title({ text, classes = [] }: { text: string; classes?: string[] }) {
  return <GtkLabel label={text} xalign={0} hexpand ellipsize={Pango.EllipsizeMode.END} widthChars={1} singleLineMode cssClasses={classes} />;
}

/** At a column and row of a grid. */
function At({ column, row, span = 1, rows = 1, children }: { column: number; row: number; span?: number; rows?: number; children: ReactNode }) {
  return (
    <GtkGridLayoutChild column={column} row={row} columnSpan={span} rowSpan={rows}>
      {children}
    </GtkGridLayoutChild>
  );
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function CalendarView({ view, rows, schema, bodies, cells, searchQuery, onOpenBody, onUpdateRow, onAddRow }: ViewProps) {
  const dark = useDark();
  const colorsOf = useRowColors(view, schema);
  const embedded = useEmbedded();
  const { locale } = useDisplaySettings();
  const calField = view.calendar_field;
  const range: CalendarRangeName = useCalendarRange(view.id) ?? "month";
  // Read once: a calendar left open past midnight keeps its day until it's shown again.
  const [today] = useState(() => dateKey(new Date()));
  // The month it opens on; today in it when that's this month, so a week opens on this week.
  const [cursor, setCursor] = useState(() => {
    const first = dateKey(initialMonth(view, rows));
    return first.slice(0, 7) === today.slice(0, 7) ? today : first;
  });
  const [showUndated, setShowUndated] = useState(false);
  // Narrow, as a phone is: a week's seven hour columns don't fit, so it's listed as an agenda (the Mac's phone layout).
  const [compact, setCompact] = useState(false);
  // Where the week's "now" line is, as the calendar opened.
  const [now] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const [listedDay, setListedDay] = useState<string | null>(null);
  const jump = useRef<Gtk.MenuButton | null>(null);

  if (!calField) {
    return (
      <AdwStatusPage vexpand iconName="x-office-calendar-symbolic" title="No Date Field" description="Choose which date field this calendar uses in View Settings." />
    );
  }

  const { entries, undated } = calendarEntries(view, rows);
  const field = schema.fields.find((f) => f.name === calField);
  const isDatetime = field?.type === "datetime";
  const titleField = schema.fields[0]?.name;
  const labelOf = (row: Row) => rowTitle(row, titleField);
  const colorOf = (row: Row) => colorsOf(row).row;
  const weekStart = firstDayOfWeek(locale);
  const offDay = (column: number) => (column + weekStart) % 7 === 0 || (column + weekStart) % 7 === 6;
  const weekdayNames = rotateWeekdays(weekdayNamesShort(locale), weekStart);
  const cursorDate = localDay(cursor)!;
  const firstOfCursor = `${cursor.slice(0, 7)}-01`;
  const lastOfCursor = dateKey(calendarDate(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 0));
  const thisWeek = weekDays(cursor, weekStart);

  // Moving about: a month or a week at a time, inside the view's range when it has one.
  const { start: minMonth, end: maxMonth } = calendarBounds(view);
  const inBounds = (key: string) => {
    const month = localDay(`${key.slice(0, 7)}-01`)!;
    return (!minMonth || month >= minMonth) && (!maxMonth || month <= maxMonth);
  };
  const stepFrom = range === "week" ? cursor : firstOfCursor;
  const canGo = (by: number) => {
    const next = stepRange(range, stepFrom, by);
    return next !== stepFrom && inBounds(next);
  };
  const go = (by: number) => {
    if (canGo(by)) setCursor(stepRange(range, stepFrom, by));
  };
  const jumpTo = (day: string) => {
    if (!localDay(day) || !inBounds(day)) return;
    setCursor(day);
  };
  const unit = range === "week" ? "week" : "month";
  const heading =
    range === "week"
      ? `${localDay(thisWeek[0]!)!.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${localDay(thisWeek[6]!)!.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`
      : `${monthNameLong(cursorDate, locale)} ${cursorDate.getFullYear()}`;
  const longDay = (key: string) => localDay(key)!.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  // Editing, where the table can be: a date worked out by a formula isn't moved, and a value that
  // isn't a real date (in No Date) isn't written over by a drag: its text is kept.
  const worksOut = (id: string, name: string | undefined) =>
    !!name && (!!schema.fields.find((f) => f.name === name)?.computed || !!cells?.some((c) => c.id === id && c.field === name && c.expr));
  const canDrag = (id: string, end: boolean) => {
    if (!onUpdateRow) return false;
    const row = rows.find((r) => r.id === id);
    if (!row) return false;
    const held = row[calField];
    const dated = entries.some((e) => e.row.id === id);
    if (!dated && held !== undefined && held !== null && held !== "") return false;
    if (end) return !!view.calendar_end_field && !worksOut(id, view.calendar_end_field);
    return !worksOut(id, calField) && !(dated && row[view.calendar_end_field ?? ""] && worksOut(id, view.calendar_end_field));
  };
  const valueOn = (day: string) => (isDatetime ? `${day}T09:00:00` : day);
  const canAdd = !!onAddRow && !!onUpdateRow && !field?.computed;
  const addOn = (day: string) => {
    if (!canAdd) return;
    const id = onAddRow!();
    if (typeof id === "string") onUpdateRow!(id, calField, valueOn(day));
  };
  const drop = ({ id, end }: { id: string; end: boolean }, day: string, minutes?: number) => {
    if (!onUpdateRow || !canDrag(id, end)) return;
    const entry = entries.find((e) => e.row.id === id);
    const at = minutes !== undefined && isDatetime ? Math.max(0, Math.min(1425, Math.round(minutes / 15) * 15)) : undefined;
    const patch = entry
      ? end
        ? resizeEntry(view, entry, day)
        : at !== undefined
          ? retimeEntry(view, entry, day, at)
          : entry.start === day
            ? null
            : moveEntry(view, entry, day)
      : { [calField]: at !== undefined ? `${day}T${clock(at)}:00` : valueOn(day) };
    if (!patch) return;
    for (const [name, value] of Object.entries(patch)) onUpdateRow(id, name, value);
  };
  /** A day takes a drop, and a double click adds a row on it. */
  const dayControllers = (day: string) => (
    <>
      {onUpdateRow ? dropOn((what) => drop(what, day)) : null}
      {canAdd ? (
        <GtkGestureClick
          onPressed={(n: number) => {
            if (n === 2) addOn(day);
          }}
        />
      ) : null}
    </>
  );
  const opens = (id: string) => (onOpenBody ? <GtkGestureClick onReleased={(n: number) => n === 1 && onOpenBody(id)} /> : null);

  /** A week's bars, over the days they cover: `top` is the grid row of the first line. */
  const bars = (segments: WeekSegment[], days: string[], top: number, lanes: number) =>
    segments
      .filter((s) => s.lane < lanes)
      .map((s) => {
        const id = s.entry.row.id;
        const single = s.span === 1 && !s.continuesBefore && !s.continuesAfter;
        const tint = single ? [] : tintClass(colorOf(s.entry.row) ?? "blue", dark);
        const resizable = !s.continuesAfter && canDrag(id, true);
        return (
          <At key={`${id}-${days[0]}`} column={s.column} row={top + s.lane} span={s.span}>
            <GtkBox
              name="calendar-bar"
              tooltipText={labelOf(s.entry.row)}
              valign={Gtk.Align.START}
              heightRequest={LANE - 2}
              marginStart={s.continuesBefore ? 0 : 4}
              marginEnd={s.continuesAfter ? 0 : 4}
              spacing={4}
              cssClasses={[
                styles.calendarBar,
                ...tint,
                ...(s.continuesBefore ? [styles.calendarBarFromBefore] : []),
                ...(s.continuesAfter ? [styles.calendarBarIntoNext] : []),
              ]}
              controllers={
                <>
                  {canDrag(id, false) ? dragOf(id) : null}
                  {opens(id)}
                  {/* Dropped on a bar: on the day under the pointer. */}
                  {onUpdateRow ? dropOn((what, x, _y, width) => drop(what, days[s.column + Math.min(s.span - 1, Math.floor((x / Math.max(1, width)) * s.span))]!)) : null}
                </>
              }
            >
              <GtkBox valign={Gtk.Align.CENTER} widthRequest={3} heightRequest={12} cssClasses={[styles.calendarTick, markClass(colorOf(s.entry.row))]} />
              {s.entry.time !== null && single ? <GtkLabel label={s.entry.time} cssClasses={[styles.calendarTime]} /> : null}
              <Title text={labelOf(s.entry.row)} classes={[styles.calendarBarTitle]} />
              {resizable ? (
                <GtkBox
                  name="calendar-bar-end"
                  widthRequest={8}
                  cursor={Gdk.Cursor.newFromName("ew-resize", null)}
                  tooltipText="Drag to change when it ends"
                  controllers={dragOf(id, true)}
                />
              ) : null}
            </GtkBox>
          </At>
        );
      });

  /** "+3 more" under a day whose bars don't all fit: the day's list. */
  const more = (segments: WeekSegment[], days: string[], row: number, lanes: number) =>
    days.map((day, column) => {
      const hidden = hiddenOnDay(segments, column, lanes);
      return hidden > 0 ? (
        <At key={`more-${day}`} column={column} row={row}>
          <GtkButton label={`+${hidden} more`} halign={Gtk.Align.START} marginStart={2} cssClasses={["flat", styles.calendarMore]} onClicked={() => setListedDay(day)} />
        </At>
      ) : null;
    });

  const weekdayRow = (
    <GtkGrid columnHomogeneous cssClasses={[styles.calendarWeekdays]}>
      {weekdayNames.map((name, i) => (
        <At key={i} column={i} row={0}>
          <GtkLabel label={name.toUpperCase()} cssClasses={["caption", "dim-label"]} marginTop={6} marginBottom={6} />
        </At>
      ))}
    </GtkGrid>
  );

  const month = () => {
    const grid = monthGrid(cursorDate, weekStart);
    const weeksShown = grid[35]!.inMonth ? 6 : 5;
    return (
      <GtkBox orientation={Gtk.Orientation.VERTICAL}>
        {weekdayRow}
        {Array.from({ length: weeksShown }, (_, w) => {
          const days = grid.slice(w * 7, w * 7 + 7).map((c) => dateKey(c.date));
          const segments = weekSegments(entries, days);
          return (
            <GtkGrid key={days[0]} name="calendar-week" columnHomogeneous>
              {days.map((day, column) => (
                <At key={`ground-${day}`} column={column} row={0} rows={MONTH_LANES + 2}>
                  <GtkBox
                    name="calendar-day"
                    heightRequest={WEEK_HEIGHT}
                    cssClasses={[styles.calendarDay, ...(offDay(column) ? [styles.calendarOffDay] : [])]}
                    controllers={dayControllers(day)}
                  />
                </At>
              ))}
              {days.map((day, column) => (
                <At key={`number-${day}`} column={column} row={0}>
                  <GtkLabel
                    label={String(Number(day.slice(8)))}
                    xalign={0}
                    marginStart={6}
                    marginTop={4}
                    marginBottom={2}
                    halign={Gtk.Align.START}
                    cssClasses={[
                      styles.calendarNumber,
                      ...(day === today ? [styles.calendarToday] : []),
                      ...(day.slice(0, 7) === cursor.slice(0, 7) ? [] : [styles.calendarOther]),
                    ]}
                  />
                </At>
              ))}
              {bars(segments, days, 1, MONTH_LANES)}
              {more(segments, days, MONTH_LANES + 1, MONTH_LANES)}
              {/* What's left of the week's height goes under its bars, not between them. */}
              <At column={0} row={MONTH_LANES + 2}>
                <GtkBox vexpand />
              </At>
            </GtkGrid>
          );
        })}
      </GtkBox>
    );
  };

  const week = () => {
    const allDay = entries.filter((e) => !isTimed(e));
    const segments = weekSegments(allDay, thisWeek);
    const lanes = Math.max(1, ...segments.map((s) => s.lane + 1));
    const hours = hourWindow(entries, thisWeek);
    const slots = (hours.last - hours.first) * SLOTS_PER_HOUR;
    const slotOf = (minutes: number) => Math.floor(minutes / 15) - hours.first * SLOTS_PER_HOUR;
    return (
      <GtkBox orientation={Gtk.Orientation.VERTICAL}>
        <GtkBox cssClasses={[styles.calendarWeekdays]}>
          <GtkBox widthRequest={GUTTER} />
          <GtkGrid columnHomogeneous hexpand>
            {thisWeek.map((day, i) => (
              <At key={day} column={i} row={0}>
                <GtkBox spacing={4} halign={Gtk.Align.CENTER} marginTop={6} marginBottom={6}>
                  <GtkLabel label={weekdayNames[i]!.toUpperCase()} cssClasses={["caption", "dim-label"]} />
                  <GtkLabel label={String(Number(day.slice(8)))} cssClasses={[styles.calendarNumber, ...(day === today ? [styles.calendarToday] : [])]} />
                </GtkBox>
              </At>
            ))}
          </GtkGrid>
        </GtkBox>
        {/* The all-day line: what has no time, and what runs over several days. */}
        <GtkBox cssClasses={[styles.calendarAllDay]}>
          <GtkLabel label="all-day" widthRequest={GUTTER} valign={Gtk.Align.START} marginTop={4} cssClasses={["caption", "dim-label"]} />
          <GtkGrid name="calendar-all-day" columnHomogeneous hexpand>
            {thisWeek.map((day, column) => (
              <At key={`ground-${day}`} column={column} row={0} rows={lanes}>
                <GtkBox heightRequest={lanes * LANE + 6} cssClasses={[styles.calendarAllDayDay]} controllers={dayControllers(day)} />
              </At>
            ))}
            {bars(segments, thisWeek, 0, lanes)}
          </GtkGrid>
        </GtkBox>
        <GtkBox>
          <GtkBox orientation={Gtk.Orientation.VERTICAL} widthRequest={GUTTER}>
            {Array.from({ length: hours.last - hours.first }, (_, h) => (
              <GtkLabel key={h} label={clock((hours.first + h) * 60)} heightRequest={HOUR} valign={Gtk.Align.START} yalign={0} cssClasses={["caption", "dim-label", "numeric"]} />
            ))}
          </GtkBox>
          <GtkGrid columnHomogeneous hexpand>
            {thisWeek.map((day, column) => {
              const timed = dayTimeline(entries, day);
              const columns = Math.max(1, ...timed.map((t) => t.columns));
              return (
                <At key={day} column={column} row={0}>
                  <GtkGrid name="calendar-hours" rowHomogeneous columnHomogeneous cssClasses={[styles.calendarHours, ...(offDay(column) ? [styles.calendarOffDay] : [])]}>
                    {Array.from({ length: hours.last - hours.first }, (_, h) => (
                      <At key={`hour-${h}`} column={0} row={h * SLOTS_PER_HOUR} span={columns} rows={SLOTS_PER_HOUR}>
                        <GtkBox
                          heightRequest={HOUR}
                          cssClasses={[styles.calendarHour]}
                          controllers={
                            <>
                              {onUpdateRow ? dropOn((what, _x, y) => drop(what, day, (hours.first + h) * 60 + (y / HOUR) * 60)) : null}
                              {canAdd ? <GtkGestureClick onPressed={(n: number) => n === 2 && addOn(day)} /> : null}
                            </>
                          }
                        />
                      </At>
                    ))}
                    {timed.map((t) => {
                      const id = t.entry.row.id;
                      const first = Math.max(0, slotOf(t.from));
                      const span = Math.max(1, Math.min(slots, slotOf(t.to - 1) + 1) - first);
                      return (
                        <At key={id} column={t.column} row={first} rows={span}>
                          <GtkBox
                            name="calendar-timed"
                            orientation={Gtk.Orientation.VERTICAL}
                            tooltipText={`${clock(t.from)} – ${clock(t.to)} ${labelOf(t.entry.row)}`}
                            marginEnd={2}
                            marginBottom={1}
                            overflow={Gtk.Overflow.HIDDEN}
                            cssClasses={[styles.calendarTimed, ...tintClass(colorOf(t.entry.row) ?? "blue", dark)]}
                            controllers={
                              <>
                                {canDrag(id, false) ? dragOf(id) : null}
                                {opens(id)}
                                {onUpdateRow
                                  ? dropOn((what, _x, y) => drop(what, day, (hours.first * SLOTS_PER_HOUR + first) * 15 + (y / HOUR) * 60))
                                  : null}
                              </>
                            }
                          >
                            {/* As tall as it lasts, its lines cut off below: a short entry doesn't stretch the hour. */}
                            <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER} vscrollbarPolicy={Gtk.PolicyType.EXTERNAL}>
                              <GtkBox orientation={Gtk.Orientation.VERTICAL}>
                                <GtkLabel label={t.entry.time ?? ""} xalign={0} cssClasses={[styles.calendarTime]} />
                                <Title text={labelOf(t.entry.row)} classes={[styles.calendarBarTitle]} />
                              </GtkBox>
                            </GtkScrolledWindow>
                          </GtkBox>
                        </At>
                      );
                    })}
                    {day === today && now >= hours.first * 60 && now < hours.last * 60 ? (
                      <At column={0} row={slotOf(now)} span={columns}>
                        <GtkBox name="calendar-now" valign={Gtk.Align.START} heightRequest={2} marginTop={Math.round(((now % 15) / 15) * (HOUR / SLOTS_PER_HOUR))} cssClasses={[styles.calendarNow]} />
                      </At>
                    ) : null}
                  </GtkGrid>
                </At>
              );
            })}
          </GtkGrid>
        </GtkBox>
      </GtkBox>
    );
  };

  /** An entry on its own line, in a day's list or the agenda. */
  const entryLine = (entry: CalendarEntry, day: string) => {
    const id = entry.row.id;
    return (
      <GtkListBoxRow key={`${id}-${day}`} activatable={!!onOpenBody} onActivate={() => onOpenBody?.(id)}>
        <GtkBox spacing={8} marginStart={12} marginEnd={12} marginTop={8} marginBottom={8} controllers={canDrag(id, false) ? dragOf(id) : undefined}>
          <GtkBox valign={Gtk.Align.CENTER} widthRequest={8} heightRequest={8} cssClasses={[styles.calendarDot, markClass(colorOf(entry.row))]} />
          <Title text={labelOf(entry.row)} />
          {bodies?.[id] !== undefined ? <GtkLabel label="Page" cssClasses={[styles.bodyBadge]} /> : null}
          <GtkLabel
            label={entry.start !== entry.end ? `Day ${daysBetween(entry.start, day) + 1} of ${daysBetween(entry.start, entry.end) + 1}` : (entry.time ?? "all-day")}
            cssClasses={["dim-label", "numeric", "caption"]}
          />
        </GtkBox>
      </GtkListBoxRow>
    );
  };

  const agenda = (from: string, to: string) => {
    const days = agendaDays(entries, from, to);
    if (days.length === 0) return <GtkLabel key="nothing" label="Nothing in this period." cssClasses={["dim-label"]} marginTop={24} marginBottom={24} />;
    return (
      <GtkBox key={`agenda-${from}`} name="calendar-agenda" orientation={Gtk.Orientation.VERTICAL} spacing={6} marginTop={6}>
        {days.map(({ day, entries: on }) => (
          <GtkBox key={day} orientation={Gtk.Orientation.VERTICAL} spacing={6} controllers={dayControllers(day)}>
            <GtkLabel label={longDay(day)} xalign={0} cssClasses={["heading", ...(day === today ? [styles.calendarToday] : [])]} marginTop={6} />
            <GtkListBox cssClasses={["boxed-list"]} selectionMode={Gtk.SelectionMode.NONE}>
              {on.map((e) => entryLine(e, day))}
            </GtkListBox>
          </GtkBox>
        ))}
      </GtkBox>
    );
  };

  const header = (
    <AdwWrapBox name="calendar-controls" justify={Adw.JustifyMode.SPREAD} justifyLastLine childSpacing={6} lineSpacing={6} marginBottom={6}>
      <GtkBox>
      <GtkMenuButton
        ref={jump}
        name="calendar-heading"
        label={heading}
        tooltipText="Go to date"
        cssClasses={["flat", styles.calendarHeading]}
        popover={
          <GtkPopover>
            <GtkCalendar
              {...(() => {
                const shown = localDay(range === "week" ? cursor : firstOfCursor)!;
                return { year: shown.getFullYear(), month: shown.getMonth(), day: shown.getDate() };
              })()}
              onDaySelected={(c: Gtk.Calendar) => {
                const d = c.getDate();
                jumpTo(dateKey(calendarDate(d.getYear(), d.getMonth() - 1, d.getDayOfMonth())));
                jump.current?.popdown();
              }}
            />
          </GtkPopover>
        }
      />
      </GtkBox>
      <GtkBox spacing={6}>
        <AdwToggleGroup
          name="calendar-range"
          activeName={range}
          onNotifyActiveName={(name) => {
            if ((name === "month" || name === "week" || name === "agenda") && name !== range) setCalendarRange(view.id, name);
          }}
        >
          <AdwToggle name="month" label="Month" />
          <AdwToggle name="week" label="Week" />
          <AdwToggle name="agenda" label="Agenda" />
        </AdwToggleGroup>
        <GtkBox cssClasses={["linked"]}>
          <GtkButton iconName="go-previous-symbolic" tooltipText={`Previous ${unit}`} sensitive={canGo(-1)} onClicked={() => go(-1)} />
          <GtkButton label="Today" sensitive={inBounds(today)} onClicked={() => jumpTo(today)} />
          <GtkButton iconName="go-next-symbolic" tooltipText={`Next ${unit}`} sensitive={canGo(1)} onClicked={() => go(1)} />
        </GtkBox>
      </GtkBox>
    </AdwWrapBox>
  );

  const listed = listedDay ? entriesOn(entries, listedDay) : [];
  const undatedLine = (row: Row) => (
    <GtkListBoxRow key={row.id} activatable={!!onOpenBody} onActivate={() => onOpenBody?.(row.id)}>
      <GtkBox spacing={8} marginStart={12} marginEnd={12} marginTop={8} marginBottom={8}>
        <GtkBox valign={Gtk.Align.CENTER} widthRequest={8} heightRequest={8} cssClasses={[styles.calendarDot, markClass(colorOf(row))]} />
        <Title text={labelOf(row)} />
      </GtkBox>
    </GtkListBoxRow>
  );

  // Searching: what it found, wherever it is in time, each once, under its day; then what has no date.
  const searchResults = () => {
    if (entries.length === 0 && undated.length === 0) return <GtkLabel label="No matches." cssClasses={["dim-label"]} marginTop={24} marginBottom={24} />;
    const days = [...new Set(entries.map((e) => e.start))];
    const group = (key: string, title: string, lines: ReactNode[], isToday = false) => (
      <GtkBox key={key} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <GtkLabel label={title} xalign={0} cssClasses={["heading", ...(isToday ? [styles.calendarToday] : [])]} marginTop={6} />
        <GtkListBox cssClasses={["boxed-list"]} selectionMode={Gtk.SelectionMode.NONE}>
          {lines}
        </GtkListBox>
      </GtkBox>
    );
    return (
      <GtkBox name="calendar-found" orientation={Gtk.Orientation.VERTICAL} spacing={6} marginTop={6}>
        {days.map((day) =>
          group(
            day,
            localDay(day)!.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
            entries.filter((e) => e.start === day).map((e) => entryLine(e, day)),
            day === today,
          ),
        )}
        {undated.length > 0 ? group("undated", "No Date", undated.map(undatedLine)) : null}
      </GtkBox>
    );
  };

  return (
    <AdwBreakpointBin
      hexpand
      widthRequest={300}
      heightRequest={embedded ? 120 : 240}
      breakpoints={<AdwBreakpoint condition={Adw.BreakpointCondition.parse("max-width: 600sp")} onApply={() => setCompact(true)} onUnapply={() => setCompact(false)} />}
    >
    <GtkScrolledWindow hexpand {...scrollerHeight(embedded)} hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkBox orientation={Gtk.Orientation.VERTICAL} {...viewMargins(embedded)}>
        {header}
        {searchQuery ? (
          searchResults()
        ) : range === "agenda" ? (
          agenda(firstOfCursor, lastOfCursor)
        ) : range === "week" && compact ? (
          agenda(thisWeek[0]!, thisWeek[6]!)
        ) : (
          // Keyed: an agenda in its place is a box too, and a class taken away isn't taken off a box kept.
          <GtkBox key="grid" cssClasses={["card", styles.calendar]} overflow={Gtk.Overflow.HIDDEN}>
            {range === "week" ? week() : month()}
          </GtkBox>
        )}
        {/* No Date, as the Mac has it: under the calendar, opened to its rows as chips that drag onto a day. */}
        {!searchQuery && undated.length > 0 ? (
          <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={8} marginTop={12}>
            <GtkToggleButton
              name="calendar-no-date"
              active={showUndated}
              halign={Gtk.Align.START}
              cssClasses={["flat"]}
              onToggled={(self: Gtk.ToggleButton) => setShowUndated(self.getActive())}
            >
              <GtkBox spacing={6}>
                <GtkImage iconName={showUndated ? "pan-down-symbolic" : "pan-end-symbolic"} />
                <GtkLabel label="No Date" cssClasses={["heading"]} />
                <GtkLabel label={String(undated.length)} cssClasses={["dim-label", "numeric"]} />
              </GtkBox>
            </GtkToggleButton>
            {showUndated ? (
              <AdwWrapBox name="calendar-undated" childSpacing={6} lineSpacing={6}>
                {undated.map((row) => (
                  <GtkBox
                    key={row.id}
                    tooltipText={canDrag(row.id, false) ? "Drag onto a day to give it a date" : undefined}
                    cssClasses={[styles.calendarChip, ...tintClass(colorOf(row) ?? "blue", dark)]}
                    controllers={
                      <>
                        {canDrag(row.id, false) ? dragOf(row.id) : null}
                        {opens(row.id)}
                      </>
                    }
                  >
                    <GtkLabel label={labelOf(row)} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={28} cssClasses={[styles.calendarBarTitle]} />
                  </GtkBox>
                ))}
              </AdwWrapBox>
            ) : null}
          </GtkBox>
        ) : null}
        {listedDay ? (
          <AdwDialog title={longDay(listedDay)} contentWidth={360} onClosed={() => setListedDay(null)}>
            <AdwToolbarView topBar={<AdwHeaderBar />}>
              <GtkListBox cssClasses={["boxed-list"]} selectionMode={Gtk.SelectionMode.NONE} marginStart={12} marginEnd={12} marginBottom={12}>
                {listed.map((e) => entryLine(e, listedDay))}
              </GtkListBox>
            </AdwToolbarView>
          </AdwDialog>
        ) : null}
      </GtkBox>
    </GtkScrolledWindow>
    </AdwBreakpointBin>
  );
}
