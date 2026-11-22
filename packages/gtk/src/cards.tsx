// The views that show rows as cards, on GTK: board, gallery and list
// (the calendar is calendar.tsx). Which card goes where comes from table-ui's shared `cards`
// module, the same code the web views run; only the drawing is here.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { GtkAdjustment, GtkBox, GtkButton, GtkEventControllerKey, GtkLabel, GtkScrolledWindow } from "@gtkx/jsx/gtk";
import type { Field, ParsedTable, Row } from "@workspace.sh/table-core";
import {
  BOARD_GAP,
  boardColumns,
  columnOf,
  columnValue,
  orderAfterDrop,
  orderMovedTo,
  bodyExcerpt,
  cardFields,
  fieldsByName,
  GALLERY_GAP,
  galleryLayout,
  groupedRows,
  pillFor,
  rowTitle,
  visibleFields,
  type ViewProps,
  columnLabel,
  boardCardMove,
  moveInColumns,
  moveInGrid,
  nudge,
  orderSwapped,
} from "@workspace.sh/table-ui/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { gridKeyOf } from "./gridKeys.js";
import { AttachmentPicture, useAttachmentPaintable } from "./AttachmentImage.js";
import { CellValue } from "./CellValue.js";
import { dragRow, dropRow } from "./drag.js";
import { styles, tintClass, useDark } from "./theme.js";
import { useRowColors } from "./rowColors.js";
import { bottomIn, childAt, drawnOf, useEmbedded, useEmbeddedScroller, viewMargins } from "./embedded.js";

/** A board column's width: the web board's. */
const BOARD_COLUMN_WIDTH = 268;
/** Between one card and the next down a board's column. */
const BOARD_CARD_GAP = 8;

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
          {/* The badge follows the title, as on the web's card: the title takes only the room its words need, up to the card's. */}
          <GtkLabel label={rowTitle(row, titleField)} xalign={0} ellipsize={Pango.EllipsizeMode.END} cssClasses={[styles.cardTitle]} tooltipText={rowTitle(row, titleField)} />
          {hasBody ? <GtkLabel label="Page" cssClasses={[styles.bodyBadge]} valign={Gtk.Align.CENTER} /> : null}
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
function CardButton({
  onActivate,
  width,
  children,
  controllers,
  cardRef,
  onKey,
  plain,
  tint = [],
}: {
  onActivate?: () => void;
  width?: number;
  children: ReactNode;
  /** Its drag source and drop target, when the view can be rearranged. */
  controllers?: ReactNode;
  /** Where the view keeps it, to move the keyboard to it. */
  cardRef?: (widget: Gtk.Button | null) => void;
  /** A key pressed on it: true when the view used it (see useCardKeys). */
  onKey?: (key: string, alt: boolean) => boolean;
  /** A list's row: a line of the list with a rule under it, not a card with a frame of its own. */
  plain?: boolean;
  /** The row's colour from the view's colour rules (D53), as a class. */
  tint?: string[];
}) {
  return (
    <GtkButton
      ref={cardRef}
      cssClasses={[...(plain ? ["flat", styles.listRow] : ["card", styles.card]), ...tint]}
      widthRequest={width}
      hexpand={width === undefined}
      onClicked={() => onActivate?.()}
      controllers={
        <>
          {controllers}
          {onKey ? (
            <GtkEventControllerKey
              onKeyPressed={(keyval, _code, state) => {
                const k = gridKeyOf(keyval, state);
                return !!k && onKey(k.key, !!k.alt);
              }}
            />
          ) : null}
        </>
      }
    >
      {children}
    </GtkButton>
  );
}

/**
 * The keyboard on cards, as the web's views have it: arrows move between
 * cards by `move` (table-ui/shared's moveInColumns or moveInGrid, not
 * GTK's own nearest-widget order), and Option/Alt+arrows go to `onAltKey`,
 * which moves the card itself. The card keeps the keyboard as it moves.
 */
function useCardKeys({ move, onAltKey }: { move: (id: string, key: string) => string; onAltKey?: (id: string, key: string) => boolean }) {
  const cards = useRef(new Map<string, Gtk.Button>());
  const focusNext = useRef<string | null>(null);
  // A moved card is drawn again in its new place: the keyboard follows it there.
  useEffect(() => {
    if (!focusNext.current) return;
    cards.current.get(focusNext.current)?.grabFocus();
    focusNext.current = null;
  });
  return {
    cardRef: (id: string) => (widget: Gtk.Button | null) => {
      if (widget) cards.current.set(id, widget);
      else cards.current.delete(id);
    },
    onKey: (id: string) => (key: string, alt: boolean) => {
      if (!/^(Arrow|Home$|End$)/.test(key)) return false;
      if (alt) {
        if (!onAltKey?.(id, key)) return false;
        focusNext.current = id;
        return true;
      }
      const next = move(id, key);
      if (next !== id) cards.current.get(next)?.grabFocus();
      return true;
    },
  };
}

export function BoardView({ view, rows, schema, bodies, onOpenBody, onUpdateRow, onUpdateView, relatedTables, onOpenRelation }: ViewProps) {
  const dark = useDark();
  const colorsOf = useRowColors(view, schema);
  const embedded = useEmbedded();
  const board = boardColumns(view, rows, schema);
  // A card dropped into a column takes its value; where it lands in the
  // column sets the view's order, as on the web (orderAfterDrop).
  const drop = (column: string, rowId: string, slot: { id: string; after: boolean } | null) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row || (slot && slot.id === rowId)) return;
    if (columnOf(row, board.field) !== column) onUpdateRow?.(rowId, board.field, columnValue(column));
    onUpdateView?.({ order: orderAfterDrop(rows, board, rowId, column, slot) });
  };
  const draggable = !!onUpdateRow;
  const fields = cardFields(view, schema, board.field);
  const fieldMap = fieldsByName(schema);
  const groupField = fieldMap.get(board.field);
  // The cards drawn in a column: all of them, or the first few when the board is embedded and cut to a count.
  const drawn = (key: string) => {
    const members = board.groups[key] ?? [];
    return members.slice(0, drawnOf(embedded, embedded?.cards, members.length));
  };
  const columns = board.keys.map((key) => drawn(key).map((r) => r.id));
  const keys = useCardKeys({
    move: (id, key) => moveInColumns(columns, id, key),
    // Option/Alt+← → to the next column, ↑ ↓ within it: what dragging does.
    onAltKey: (id, key) => {
      const moved = onUpdateRow ? boardCardMove(columns, board.keys, id, key) : null;
      if (moved?.kind === "column") onUpdateRow!(id, board.field, columnValue(moved.column));
      else if (moved?.kind === "swap" && onUpdateView) onUpdateView({ order: orderSwapped(rows, id, moved.with) });
      else return false;
      return true;
    },
  });

  // Embedded and asked for so many cards: as tall as the column that reaches furthest by its
  // nth card, when some column has more. (A column's first child is its heading.)
  const columnsBox = useRef<Gtk.Box | null>(null);
  const cards = embedded?.cards;
  const scroller = useEmbeddedScroller(
    embedded,
    cards === undefined
      ? null
      : () => {
          const box = columnsBox.current;
          if (!box) return undefined;
          let more = false;
          let end = 0;
          for (let column = box.getFirstChild(); column; column = column.getNextSibling()) {
            const last = childAt(column, cards);
            if (last?.getNextSibling()) more = true;
            const shown = last ?? column.getLastChild();
            const bottom = shown ? bottomIn(shown, box) : undefined;
            if (bottom === undefined) return undefined;
            end = Math.max(end, bottom);
          }
          return more ? end + BOARD_CARD_GAP / 2 : null;
        },
  );

  return (
    <GtkScrolledWindow hexpand {...scroller} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
      <GtkBox ref={columnsBox} spacing={BOARD_GAP} {...viewMargins(embedded)} valign={Gtk.Align.START}>
        {board.keys.map((key) => {
          const members = board.groups[key] ?? [];
          const pill = key === "(empty)" ? { label: columnLabel(groupField, key), color: undefined } : pillFor(groupField, key);
          return (
            <GtkBox
              key={key}
              orientation={Gtk.Orientation.VERTICAL}
              spacing={BOARD_CARD_GAP}
              widthRequest={BOARD_COLUMN_WIDTH}
              cssClasses={[styles.boardColumn]}
              valign={Gtk.Align.START}
              // Dropped on the column itself: after its last card.
              controllers={draggable ? dropRow((id) => drop(key, id, null)) : undefined}
            >
              <GtkBox spacing={8} marginStart={4}>
                {/* The column's name in small capitals and how many cards it has, as every platform's board says it. */}
                <GtkLabel label={pill.label} cssClasses={[styles.groupLabel]} />
                <GtkLabel label={String(members.length)} cssClasses={[styles.groupCount]} />
              </GtkBox>
              {drawn(key).map((row) => (
                <CardButton
                  key={row.id}
                  tint={tintClass(colorsOf(row).row, dark)}
                  onActivate={onOpenBody ? () => onOpenBody(row.id) : undefined}
                  cardRef={keys.cardRef(row.id)}
                  onKey={keys.onKey(row.id)}
                  controllers={
                    draggable ? (
                      <>
                        {dragRow(row.id)}
                        {/* Dropped on a card: before it, or after it in its lower half. */}
                        {dropRow((id, lower) => drop(key, id, { id: row.id, after: lower }))}
                      </>
                    ) : undefined
                  }
                >
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
              {members.length > drawn(key).length ? (
                <GtkLabel name="board-column-more" label={`+${members.length - drawn(key).length} more`} xalign={0} marginStart={4} cssClasses={["caption", "dim-label"]} />
              ) : null}
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
  const dark = useDark();
  const colorsOf = useRowColors(view, schema);
  const embedded = useEmbedded();
  const heroField = view.gallery_field;
  const fields = cardFields(view, schema, heroField);
  const fieldMap = fieldsByName(schema);
  // The gallery's width, less its margins, from the scroller's own page.
  const [width, setWidth] = useState(0);
  const { perRow } = galleryLayout(Math.max(0, width - (embedded ? 2 * (embedded.gutter ?? 0) : 24)));
  // Embedded and cut to a count, only the first cards are drawn.
  const drawn = rows.slice(0, drawnOf(embedded, embedded?.cards, rows.length));
  const lines: Row[][] = [];
  for (let i = 0; i < drawn.length; i += perRow) lines.push(drawn.slice(i, i + perRow));
  const ids = drawn.map((r) => r.id);
  const keys = useCardKeys({ move: (id, key) => moveInGrid(ids, perRow, id, key) });

  // Embedded and asked for so many cards: as tall as the lines that hold them, when there are more.
  const linesBox = useRef<Gtk.Box | null>(null);
  const cards = embedded?.cards;
  const scroller = useEmbeddedScroller(
    embedded,
    cards === undefined
      ? null
      : () => {
          const box = linesBox.current;
          const last = box ? childAt(box, Math.ceil(cards / perRow) - 1) : null;
          if (!box || !last) return box && box.getFirstChild() ? null : undefined;
          if (!last.getNextSibling()) return null;
          const bottom = bottomIn(last, box);
          return bottom === undefined ? undefined : bottom + GALLERY_GAP / 2;
        },
  );

  return (
    <GtkScrolledWindow
      hexpand
      {...scroller}
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      hadjustment={<GtkAdjustment onNotifyPageSize={(size) => setWidth(Math.floor(size ?? 0))} />}
    >
      <GtkBox ref={linesBox} orientation={Gtk.Orientation.VERTICAL} spacing={GALLERY_GAP} {...viewMargins(embedded)}>
        {lines.map((line) => (
          // Homogeneous, and a short last line padded with empty slots, so
          // every card is the same width and lines up with the one above.
          <GtkBox key={line[0]!.id} spacing={GALLERY_GAP} homogeneous>
            {line.map((row) => {
              const excerpt = bodyExcerpt(bodies?.[row.id], fields[0] ? rowTitle(row, fields[0]) : undefined);
              return (
                <CardButton key={row.id} tint={tintClass(colorsOf(row).row, dark)} onActivate={onOpenBody ? () => onOpenBody(row.id) : undefined} cardRef={keys.cardRef(row.id)} onKey={keys.onKey(row.id)}>
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

export function ListView({ view, rows, schema, bodies, onOpenBody, onUpdateView, relatedTables, onOpenRelation }: ViewProps) {
  const dark = useDark();
  const colorsOf = useRowColors(view, schema);
  const embedded = useEmbedded();
  // A row dropped on another takes its place in the view's order (orderMovedTo).
  const reorderable = !!onUpdateView;
  const fields = visibleFields(view, schema);
  const [titleField, ...secondary] = fields;
  const fieldMap = fieldsByName(schema);
  const everyRow = groupedRows(view, rows, schema);
  // Embedded and cut to a count, only the first rows are drawn.
  const listed = everyRow.slice(0, drawnOf(embedded, embedded?.rows, everyRow.length));
  const groupTitle = view.group ? (fieldMap.get(view.group.field)?.title ?? view.group.field) : "";
  const keys = useCardKeys({
    move: (id, key) => moveInColumns([listed.map((d) => d.row.id)], id, key),
    // Option/Alt+↑ ↓ moves the row, as dragging it does.
    onAltKey: (id, key) => {
      if (!onUpdateView || (key !== "ArrowUp" && key !== "ArrowDown")) return false;
      onUpdateView({ order: nudge(rows.map((r) => r.id), id, key === "ArrowUp" ? -1 : 1) });
      return true;
    },
  });

  // Embedded and asked for so many rows: as tall as they are (a group's heading with its first row), when there are more.
  const rowsBox = useRef<Gtk.Box | null>(null);
  const shownRows = embedded?.rows;
  const scroller = useEmbeddedScroller(
    embedded,
    shownRows === undefined
      ? null
      : () => {
          const box = rowsBox.current;
          const last = box ? childAt(box, shownRows - 1) : null;
          if (!box || !last) return box && box.getFirstChild() ? null : undefined;
          if (!last.getNextSibling()) return null;
          return bottomIn(last, box);
        },
  );

  return (
    <GtkScrolledWindow hexpand {...scroller} hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkBox ref={rowsBox} orientation={Gtk.Orientation.VERTICAL} {...viewMargins(embedded)}>
        {listed.map(({ row, starts }) => (
          <GtkBox key={row.id} orientation={Gtk.Orientation.VERTICAL}>
            {starts ? (
              <GtkLabel label={`${groupTitle} · ${starts.label}`} xalign={0} marginTop={14} marginBottom={6} marginStart={4} cssClasses={[styles.groupLabel]} />
            ) : null}
            <CardButton
              plain
              tint={tintClass(colorsOf(row).row, dark)}
              onActivate={() => onOpenBody?.(row.id)}
              cardRef={keys.cardRef(row.id)}
              onKey={keys.onKey(row.id)}
              controllers={
                reorderable ? (
                  <>
                    {dragRow(row.id)}
                    {dropRow((id) => id !== row.id && onUpdateView?.({ order: orderMovedTo(rows, id, row.id) }))}
                  </>
                ) : undefined
              }
            >
              {/* The title at the start, with its page's badge; what else the list shows at the end, quieter. */}
              <GtkBox spacing={16}>
                <GtkBox spacing={6} hexpand>
                  <GtkLabel label={rowTitle(row, titleField)} xalign={0} ellipsize={Pango.EllipsizeMode.END} cssClasses={[styles.listTitle]} tooltipText={rowTitle(row, titleField)} />
                  {bodies?.[row.id] !== undefined ? <GtkLabel label="Page" cssClasses={[styles.bodyBadge]} valign={Gtk.Align.CENTER} /> : null}
                </GtkBox>
                {secondary.map((name) => (
                  <GtkBox key={name} halign={Gtk.Align.END} widthRequest={140} cssClasses={[styles.listSecondary]}>
                    <CellValue field={fieldMap.get(name)} value={row[name]} relatedTables={relatedTables} onOpenRelation={onOpenRelation} lines={1} xalign={1} />
                  </GtkBox>
                ))}
              </GtkBox>
            </CardButton>
          </GtkBox>
        ))}
      </GtkBox>
    </GtkScrolledWindow>
  );
}
