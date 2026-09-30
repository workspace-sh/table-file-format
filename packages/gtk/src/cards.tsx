// The views that show rows as cards, on GTK: board, gallery, list and
// calendar. Which card goes where comes from table-ui's shared `cards`
// module, the same code the web views run; only the drawing is here.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { AdwDialog, AdwHeaderBar, AdwStatusPage, AdwToolbarView } from "@gtkx/jsx/adw";
import { GtkAdjustment, GtkBox, GtkButton, GtkLabel, GtkListBox, GtkListBoxRow, GtkScrolledWindow } from "@gtkx/jsx/gtk";
import type { Field, ParsedTable, Row } from "@workspace.sh/table-core";
import {
  BOARD_GAP,
  boardColumns,
  bodyExcerpt,
  CALENDAR_CHIPS_PER_DAY,
  canStep,
  cardFields,
  dateKey,
  fieldsByName,
  firstDayOfWeek,
  GALLERY_GAP,
  galleryLayout,
  groupedRows,
  initialMonth,
  localDay,
  monthGrid,
  monthNameLong,
  pillFor,
  rotateWeekdays,
  rowsByDay,
  rowTitle,
  useDisplaySettings,
  visibleFields,
  weekdayNamesShort,
  type ViewProps,
} from "@workspace.sh/table-ui/shared";
import { useState, type ReactNode } from "react";
import { AttachmentPicture, useAttachmentPaintable } from "./AttachmentImage.js";
import { CellValue } from "./CellValue.js";
import { pillClass, styles, useDark } from "./theme.js";

/** A board column's width: the web board's. */
const BOARD_COLUMN_WIDTH = 268;

/** A title that ends in "…" rather than widening what holds it. */
function Title({ text, classes = [] }: { text: string; classes?: string[] }) {
  return <GtkLabel label={text} xalign={0} hexpand ellipsize={Pango.EllipsizeMode.END} maxWidthChars={1} cssClasses={classes} tooltipText={text} />;
}

interface CardProps {
  row: Row;
  fields: string[];
  fieldMap: Map<string, Field>;
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
  /** The first field is the card's title (board, list); a gallery's hero stands in for it instead. */
  titled?: boolean;
  hasBody?: boolean;
}

/** A card's fields, each as its title over its value (the web card's two columns, stacked to fit GTK's type). */
function CardFields({ row, fields, fieldMap, relatedTables, onOpenRelation }: CardProps) {
  return (
    <>
      {fields.map((name) => (
        <GtkBox key={name} spacing={8}>
          <GtkLabel
            label={(fieldMap.get(name)?.title ?? name).toUpperCase()}
            xalign={0}
            widthRequest={96}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={1}
            cssClasses={[styles.cardFieldLabel]}
          />
          <GtkBox hexpand>
            <CellValue field={fieldMap.get(name)} value={row[name]} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={1} />
          </GtkBox>
        </GtkBox>
      ))}
    </>
  );
}

function Card({ row, fields, fieldMap, relatedTables, onOpenRelation, titled = true, hasBody }: CardProps) {
  const [titleField, ...rest] = fields;
  return (
    <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      {titled && titleField ? (
        <GtkBox spacing={6}>
          <Title text={rowTitle(row, titleField)} classes={[styles.cardTitle]} />
          {hasBody ? <GtkLabel label="DOC" cssClasses={[styles.bodyBadge]} valign={Gtk.Align.CENTER} /> : null}
        </GtkBox>
      ) : null}
      <CardFields row={row} fields={titled ? rest : fields} fieldMap={fieldMap} relatedTables={relatedTables} onOpenRelation={onOpenRelation} />
    </GtkBox>
  );
}

/**
 * A card as a flat button: the card's own frame, and activating it opens
 * the row's page when the app has one. A card with nothing to open is
 * still focusable, so the keyboard walks every card.
 */
function CardButton({ onActivate, width, children }: { onActivate?: () => void; width?: number; children: ReactNode }) {
  return (
    <GtkButton cssClasses={["card", styles.card]} widthRequest={width} hexpand={width === undefined} onClicked={() => onActivate?.()}>
      {children}
    </GtkButton>
  );
}

export function BoardView({ view, rows, schema, bodies, onOpenBody, relatedTables, onOpenRelation }: ViewProps) {
  const board = boardColumns(view, rows, schema);
  const fields = cardFields(view, schema, board.field);
  const fieldMap = fieldsByName(schema);
  const groupField = fieldMap.get(board.field);
  const dark = useDark();

  return (
    <GtkScrolledWindow hexpand vexpand vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
      <GtkBox spacing={BOARD_GAP} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12} valign={Gtk.Align.START}>
        {board.keys.map((key) => {
          const members = board.groups[key] ?? [];
          const pill = key === "(empty)" ? { label: "Empty", color: undefined } : pillFor(groupField, key);
          return (
            <GtkBox
              key={key}
              orientation={Gtk.Orientation.VERTICAL}
              spacing={8}
              widthRequest={BOARD_COLUMN_WIDTH}
              cssClasses={[styles.boardColumn]}
              valign={Gtk.Align.START}
            >
              <GtkBox spacing={8} marginStart={4}>
                <GtkLabel label={pill.label} cssClasses={[styles.pill, pillClass(pill.color, dark)]} />
                <GtkLabel label={String(members.length)} cssClasses={["dim-label", "numeric"]} />
              </GtkBox>
              {members.map((row) => (
                <CardButton key={row.id} onActivate={onOpenBody ? () => onOpenBody(row.id) : undefined}>
                  <Card
                    row={row}
                    fields={fields}
                    fieldMap={fieldMap}
                    relatedTables={relatedTables}
                    onOpenRelation={onOpenRelation}
                    hasBody={bodies?.[row.id] !== undefined}
                  />
                </CardButton>
              ))}
            </GtkBox>
          );
        })}
      </GtkBox>
    </GtkScrolledWindow>
  );
}

/**
 * A gallery card's lead: the image itself when the hero field is an
 * attachment the app can find, as the web's GalleryHero does; else its
 * value as text.
 */
function GalleryHero({ field, value, text }: { field: Field | undefined; value: unknown; text: string }) {
  const fileName = field?.attachment && typeof value === "string" ? value : "";
  const paintable = useAttachmentPaintable(fileName, 200);
  if (!paintable) return <Title text={text} classes={[styles.galleryHero]} />;
  return (
    <GtkBox halign={Gtk.Align.FILL} heightRequest={120} cssClasses={[styles.galleryImage]}>
      <AttachmentPicture paintable={paintable} fileName={fileName} width={200} height={120} />
    </GtkBox>
  );
}

export function GalleryView({ view, rows, schema, bodies, onOpenBody, relatedTables, onOpenRelation }: ViewProps) {
  const heroField = view.gallery_field;
  const fields = cardFields(view, schema, heroField);
  const fieldMap = fieldsByName(schema);
  // The gallery's width, less its margins, from the scroller's own page.
  const [width, setWidth] = useState(0);
  const { perRow } = galleryLayout(Math.max(0, width - 24));
  const lines: Row[][] = [];
  for (let i = 0; i < rows.length; i += perRow) lines.push(rows.slice(i, i + perRow));

  return (
    <GtkScrolledWindow
      hexpand
      vexpand
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      hadjustment={<GtkAdjustment onNotifyPageSize={(size) => setWidth(Math.floor(size ?? 0))} />}
    >
      <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={GALLERY_GAP} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12}>
        {lines.map((line) => (
          // Homogeneous, and a short last line padded with empty slots, so
          // every card is the same width and lines up with the one above.
          <GtkBox key={line[0]!.id} spacing={GALLERY_GAP} homogeneous>
            {line.map((row) => {
              const excerpt = bodyExcerpt(bodies?.[row.id]);
              return (
                <CardButton key={row.id} onActivate={onOpenBody ? () => onOpenBody(row.id) : undefined}>
                  <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6}>
                    {heroField ? <GalleryHero field={fieldMap.get(heroField)} value={row[heroField]} text={rowTitle(row, heroField)} /> : null}
                    <Card
                      row={row}
                      fields={fields}
                      fieldMap={fieldMap}
                      relatedTables={relatedTables}
                      onOpenRelation={onOpenRelation}
                      titled={!heroField}
                    />
                    {excerpt ? (
                      <GtkLabel
                        label={excerpt}
                        xalign={0}
                        wrap
                        lines={3}
                        ellipsize={Pango.EllipsizeMode.END}
                        maxWidthChars={1}
                        hexpand
                        cssClasses={[styles.excerpt]}
                      />
                    ) : null}
                  </GtkBox>
                </CardButton>
              );
            })}
            {Array.from({ length: perRow - line.length }, (_, i) => (
              <GtkBox key={`pad${i}`} />
            ))}
          </GtkBox>
        ))}
      </GtkBox>
    </GtkScrolledWindow>
  );
}

export function ListView({ view, rows, schema, bodies, onOpenBody, relatedTables, onOpenRelation }: ViewProps) {
  const fields = visibleFields(view, schema);
  const [titleField, ...secondary] = fields;
  const fieldMap = fieldsByName(schema);
  const listed = groupedRows(view, rows, schema);
  const groupTitle = view.group ? (fieldMap.get(view.group.field)?.title ?? view.group.field) : "";

  return (
    <GtkScrolledWindow hexpand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12}>
        {listed.map(({ row, starts }) => (
          <GtkBox key={row.id} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            {starts ? (
              <GtkLabel label={`${groupTitle} · ${starts.label}`} xalign={0} marginTop={12} cssClasses={["heading"]} />
            ) : null}
            <GtkButton cssClasses={["card", styles.card]} onClicked={() => onOpenBody?.(row.id)}>
              <GtkBox spacing={16}>
                <GtkBox spacing={6} widthRequest={260}>
                  <Title text={rowTitle(row, titleField)} classes={[styles.cardTitle]} />
                  {bodies?.[row.id] !== undefined ? <GtkLabel label="DOC" cssClasses={[styles.bodyBadge]} valign={Gtk.Align.CENTER} /> : null}
                </GtkBox>
                {secondary.map((name) => (
                  <GtkBox key={name} widthRequest={140} hexpand>
                    <CellValue field={fieldMap.get(name)} value={row[name]} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={1} />
                  </GtkBox>
                ))}
              </GtkBox>
            </GtkButton>
          </GtkBox>
        ))}
      </GtkBox>
    </GtkScrolledWindow>
  );
}

export function CalendarView({ view, rows, schema, bodies, onOpenBody }: ViewProps) {
  const field = view.calendar_field;
  const { locale } = useDisplaySettings();
  const [month, setMonth] = useState(() => initialMonth(view, rows));
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Read once: a calendar left open past midnight keeps its day until it's shown again.
  const [today] = useState(() => dateKey(new Date()));

  if (!field) {
    return <AdwStatusPage vexpand iconName="x-office-calendar-symbolic" title="No date field" description="This view has no calendar_field to place its rows by." />;
  }

  const weekStart = firstDayOfWeek(locale);
  const weekdays = rotateWeekdays(weekdayNamesShort(locale), weekStart);
  const cells = monthGrid(month, weekStart);
  const byDay = rowsByDay(rows, field);
  const titleField = schema.fields[0]?.name;
  const step = canStep(view, month);
  const weeks = [0, 1, 2, 3, 4, 5].map((w) => cells.slice(w * 7, w * 7 + 7));
  const dayRows = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <GtkScrolledWindow hexpand vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkBox orientation={Gtk.Orientation.VERTICAL} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12} cssClasses={["card", styles.calendar]}>
        <GtkBox marginTop={6} marginBottom={6} marginStart={6} marginEnd={6}>
          <GtkButton
            iconName="go-previous-symbolic"
            cssClasses={["flat"]}
            sensitive={step.prev}
            tooltipText="Previous month"
            onClicked={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          />
          <GtkLabel label={`${monthNameLong(month, locale)} ${month.getFullYear()}`} hexpand cssClasses={["heading"]} />
          <GtkButton
            iconName="go-next-symbolic"
            cssClasses={["flat"]}
            sensitive={step.next}
            tooltipText="Next month"
            onClicked={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          />
        </GtkBox>
        <GtkBox homogeneous cssClasses={[styles.calendarWeekdays]}>
          {weekdays.map((d, i) => (
            <GtkLabel key={i} label={d.toUpperCase()} cssClasses={["caption", "dim-label"]} marginTop={6} marginBottom={6} />
          ))}
        </GtkBox>
        {weeks.map((week, w) => (
          <GtkBox key={w} homogeneous>
            {week.map((cell) => {
              const key = dateKey(cell.date);
              const entries = byDay.get(key) ?? [];
              const chips = entries.slice(0, CALENDAR_CHIPS_PER_DAY);
              const more = entries.length - chips.length;
              return (
                <GtkButton
                  key={key}
                  cssClasses={["flat", styles.calendarDay, ...(cell.inMonth ? [] : [styles.calendarOther])]}
                  heightRequest={80}
                  onClicked={() => setOpenDay(key)}
                  tooltipText={entries.length > 0 ? `${entries.length} on this day` : undefined}
                >
                  <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={2} valign={Gtk.Align.START} hexpand>
                    <GtkLabel label={String(cell.date.getDate())} xalign={0} cssClasses={key === today ? [styles.calendarToday] : ["numeric"]} />
                    {chips.map((row) => (
                      <Title key={row.id} text={rowTitle(row, titleField)} classes={[styles.calendarChip]} />
                    ))}
                    {more > 0 ? <GtkLabel label={`+${more} more`} xalign={0} cssClasses={["caption", "dim-label"]} /> : null}
                  </GtkBox>
                </GtkButton>
              );
            })}
          </GtkBox>
        ))}
        {openDay ? (
          <AdwDialog
            title={localDay(openDay)!.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            contentWidth={360}
            onClosed={() => setOpenDay(null)}
          >
            <AdwToolbarView topBar={<AdwHeaderBar />}>
              {dayRows.length === 0 ? (
                <GtkLabel label="No items on this day." cssClasses={["dim-label"]} marginTop={24} marginBottom={24} />
              ) : (
                <GtkListBox cssClasses={["boxed-list"]} selectionMode={Gtk.SelectionMode.NONE} marginStart={12} marginEnd={12} marginBottom={12}>
                  {dayRows.map((row) => (
                    <GtkListBoxRow key={row.id} activatable={!!onOpenBody} onActivate={() => onOpenBody?.(row.id)}>
                      <GtkBox spacing={6} marginStart={12} marginEnd={12} marginTop={10} marginBottom={10}>
                        <Title text={rowTitle(row, titleField)} />
                        {bodies?.[row.id] !== undefined ? <GtkLabel label="DOC" cssClasses={[styles.bodyBadge]} /> : null}
                      </GtkBox>
                    </GtkListBoxRow>
                  ))}
                </GtkListBox>
              )}
            </AdwToolbarView>
          </AdwDialog>
        ) : null}
      </GtkBox>
    </GtkScrolledWindow>
  );
}
