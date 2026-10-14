// The table layout on GTK: a header of field titles, a row per record at
// the view's row height, group headings when the view groups, and the
// totals footer. Columns are sized by the same rule as the web grid
// (`columnWidths`), so a view saved on one looks the same on the other.
//
// Plain boxes rather than GtkColumnView, as the web grid is plain elements.
// Only the rows near what's on screen are built (LARGE-TABLES-PLAN, L1):
// every row's height is known without drawing it, so the rows above and
// below are two empty boxes of their heights, and the scroller is as long
// as the whole table.
//
// The rows come from a ViewRows (table-core): the one given, for a table
// held in the index, or one made here over `rows`. Either way the table
// reads a window of them, and its groups and totals, the same way.

import * as Gdk from "@gtkx/gi/gdk";
import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { GMenu, GSimpleAction, GSimpleActionGroup } from "@gtkx/jsx/gio";
import {
  GtkAdjustment,
  GtkBox,
  GtkButton,
  GtkEventControllerFocus,
  GtkEventControllerKey,
  GtkGestureClick,
  GtkGestureDrag,
  GtkOverlay,
  GtkImage,
  GtkLabel,
  GtkMenuButton,
  GtkPopoverMenu,
  GtkScrolledWindow,
  GtkViewport,
} from "@gtkx/jsx/gtk";
import type { MenuItem } from "@gtkx/react/internal";
import { columnLetter, effectiveAlign, isSheet, memoryViewRows, type Field, type FieldAlignment, type Row, type ViewTotal } from "@workspace.sh/table-core";
import {
  canInsertAt,
  describeCell,
  fittedRowHeight,
  formulaInputCells,
  viewGrid,
  columnWidths,
  fieldsByName,
  groupLabel,
  isImmediate,
  rowLayout,
  shownTotal,
  useViewFacts,
  useViewWindow,
  DEFAULT_ROW_HEIGHT,
  type RowMark,
  linesFor,
  TOTAL_LABELS,
  TOTAL_NAMES,
  totalKindsFor,
  visibleFields,
  type ViewProps,
  rowNumber,
  rowNumberWidth,
  fieldHint,
  fieldHintText,
  rowActions,
  columnActions,
  ADD_FIELD_WIDTH,
  SQUEEZED_CELL_WIDTH,
  type FieldAction,
  type RowAction,
  resizedColumnWidth,
  rowHeightOf,
  snappedRowHeight,
  useDirection,
  afterEdit,
  cellPicks,
  editorKind,
  gridKey,
  mirroredKey,
  type GridPlace,
  useDisplaySettings,
} from "@workspace.sh/table-ui/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CellValue } from "./CellValue.js";
import { EditableCell } from "./EditableCell.js";
import { FieldAbout } from "./FieldAbout.js";
import { AddField, FieldEditor } from "./FieldEditor.js";
import { FormulaPanel } from "./FormulaPanel.js";
import { styles } from "./theme.js";
import { drawnOf, NO_LIMIT, scrollerHeight, useEmbedded } from "./embedded.js";
import { gridKeyOf } from "./gridKeys.js";

/** The web grid's rule for the chrome: its two outer borders. */
const TABLE_CHROME = 2;
const HEADER_HEIGHT = 36;
/** A body row's bottom rule. */
const ROW_RULE = 1;
/** A group's heading above its first row, rule included. */
const GROUP_ROW_HEIGHT = 33;
/** How far past the screen rows are kept built, in pixels. */
const DRAW_DISTANCE = 900;
/**
 * The tallest the rows are laid out. GTK places widgets with single-precision
 * numbers, which stop telling neighbouring pixels apart some millions of
 * pixels down: rows there would sit a few pixels off. A taller table is
 * scrolled through a body this tall (see `shift`).
 */
const MAX_BODY_HEIGHT = 8_000_000;
/** How close the screen's edge comes to the last built row before more are built. */
const DRAW_MARGIN = 300;
/** The frame's margin from the window's edges, each side. None when the table is embedded: where it sits has its own. */
const WINDOW_FRAME_MARGIN = 12;
/** Past this width the first column stays put while the others scroll sideways (table-ui's TOUCH_VIEWPORT_MAX). */
const FREEZE_FROM_WIDTH = 720;
/** How much of a row's bottom edge takes a drag to resize it, as on the web. */
const ROW_LINE_HEIGHT = 6;
/** A column's line down the table: how wide a strip takes the pointer, and how much of it is before the column's end. */
const COLUMN_LINE_WIDTH = 6;
const COLUMN_LINE_BEFORE = 4;
/** A grabber: the short bar a selected row's grip is drawn as when Display's "Resize handles" says so. */
const GRABBER_WIDTH = 26;
const GRABBER_HEIGHT = 9;
/**
 * How far a scroller is scrolled across from where its content starts, and the adjustment's value for
 * being that far. Left to right they are the same; right to left the content starts at the right, where
 * GTK's value is at its greatest.
 */
const acrossFromStart = (across: Gtk.Adjustment, rtl: boolean) => (rtl ? across.getUpper() - across.getPageSize() - across.getValue() : across.getValue());
const acrossValue = (across: Gtk.Adjustment, rtl: boolean, fromStart: number) => (rtl ? across.getUpper() - across.getPageSize() - fromStart : fromStart);
/** How long a sideways scroll is still before its columns are brought into line. */
const SNAP_AFTER_MS = 180;
const SNAP_GLIDE_MS = 160;

function xalignOf(align: FieldAlignment): number {
  return align === "center" ? 0.5 : align === "end" ? 1 : 0;
}

/**
 * One cell, exactly `width` wide whatever it holds.
 *
 * `widthRequest` keeps a short value from narrowing the column, and
 * `hexpand={false}` stops a child's expanding from spreading the cell when
 * its row is wider than another (a body row has its menu button, the
 * header has none). Nothing in a cell asks for more: text ellipsizes (its natural width is a
 * character), and a row of pills clips (see `Clipped`). Every row's cells
 * then line up under the header with no grid to align them.
 */
function Cell({
  width,
  height,
  children,
  classes = [],
  cellRef,
  onFocused,
}: {
  width: number;
  height: number;
  children: ReactNode;
  classes?: string[];
  /** A body cell: it takes the keyboard's focus, and says when it has it. */
  cellRef?: (widget: Gtk.Box | null) => void;
  onFocused?: (focused: boolean) => void;
}) {
  return (
    <GtkBox
      ref={cellRef}
      focusable={!!cellRef}
      widthRequest={width}
      heightRequest={height}
      hexpand={false}
      cssClasses={[styles.cell, styles.columnRule, ...classes]}
      controllers={onFocused ? <GtkEventControllerFocus onEnter={() => onFocused(true)} onLeave={() => onFocused(false)} /> : undefined}
    >
      {children}
    </GtkBox>
  );
}

/** The row menu's entries, by what the table was given to do. */
/** The row's own action for each of table-ui/shared's row actions. */
const ROW_ACTION: Record<RowAction["id"], string> = {
  "open-page": "row.open",
  "add-page": "row.open",
  "insert-above": "row.above",
  "insert-below": "row.below",
  "fit-row": "row.fit",
  "reset-row-height": "row.reset-height",
  delete: "row.delete",
};

/**
 * The row menu: table-ui/shared's rowActions, with the same labels as
 * on the web, the Mac and phones, in sections: the page, inserting,
 * deleting.
 */
function rowMenu(actions: RowAction[]): MenuItem[] {
  const section = (ids: RowAction["id"][]) => actions.filter((a) => ids.includes(a.id)).map((a) => ({ label: a.label, action: ROW_ACTION[a.id] }));
  return [section(["open-page", "add-page"]), section(["insert-above", "insert-below"]), section(["fit-row", "reset-row-height"]), section(["delete"])]
    .filter((items) => items.length > 0)
    .map((items) => ({ section: items }));
}

/**
 * A column's header, with its menu: About This Field, then table-ui/shared's
 * columnActions, on a right-click. The menu hangs from a button laid over the header that is
 * never seen or pressed itself: a popover needs a widget of its own to
 * open from, and the header's own click opens the field's editor.
 */
function HeaderMenu({
  actions,
  onAbout,
  overlays,
  menuRef,
  children,
}: {
  actions: FieldAction[];
  /** About This Field: what the column is, which is there to read whether or not the table can be changed. */
  onAbout: () => void;
  overlays: ReactNode;
  /** The way to open it from the keyboard (Alt+Down on one of the column's cells). */
  menuRef?: (button: Gtk.MenuButton | null) => void;
  children: ReactNode;
}) {
  const button = useRef<Gtk.MenuButton | null>(null);
  const section = (ids: FieldAction["id"][]) => actions.filter((a) => ids.includes(a.id)).map((a) => ({ label: a.label, action: `field.${a.id}` }));
  const items: MenuItem[] = [[{ label: "About This Field", action: "field.about" }], section(["insert-left", "insert-right"]), section(["reset-width"]), section(["delete-field"])]
    .filter((entries) => entries.length > 0)
    .map((entries) => ({ section: entries }));
  return (
    <GtkOverlay
      controllers={<GtkGestureClick button={3} onPressed={() => button.current?.popup()} />}
      actionGroups={
        <GSimpleActionGroup
          prefix="field"
          actions={
            <>
              <GSimpleAction name="about" onActivate={onAbout} />
              {actions.map((a) => (
                <GSimpleAction key={a.id} name={a.id} onActivate={a.onSelect} />
              ))}
            </>
          }
        />
      }
      overlays={
        <>
          <GtkMenuButton
            ref={(widget: Gtk.MenuButton | null) => {
              button.current = widget;
              menuRef?.(widget);
            }}
            opacity={0}
            canTarget={false}
            canFocus={false}
            tooltipText="Field Actions"
            popover={<GtkPopoverMenu hasArrow={false} menuModel={<GMenu items={items} />} />}
          />
          {overlays}
        </>
      }
    >
      {children}
    </GtkOverlay>
  );
}

/**
 * A body row, with its menu: a right-click anywhere on it, or the Menu key
 * with the keyboard on one of its cells, as on the web and the Mac. The
 * menu hangs from a button laid over the row that is never seen or pressed
 * itself (a popover needs a widget of its own to open from); `menuRef`
 * gives the table the way to open it from the keyboard.
 */
function BodyRow({
  rowId,
  menu,
  hasBody,
  canInsert,
  onOpenBody,
  onDeleteRow,
  onInsertRow,
  onFitRow,
  onResetRowHeight,
  menuRef,
  frozen,
  children,
}: {
  rowId: string;
  menu: boolean;
  hasBody: boolean;
  canInsert: boolean;
  onOpenBody?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
  onInsertRow?: (anchor: string, where: "above" | "below") => void;
  /** Fit the row's height to what it holds. */
  onFitRow?: (rowId: string) => void;
  /** Only for a row that was resized: back to the view's height. */
  onResetRowHeight?: (rowId: string) => void;
  menuRef?: (button: Gtk.MenuButton | null) => void;
  /** The row's first column, when it stays put while the rest scroll sideways: laid over the row's start. */
  frozen?: ReactNode;
  children: ReactNode;
}) {
  const button = useRef<Gtk.MenuButton | null>(null);
  // As wide as its cells and no wider: its rule stops at the last real column, short of the "+" after it.
  if (!menu) {
    const cells = <GtkBox halign={Gtk.Align.START} cssClasses={[styles.bodyRow]}>{children}</GtkBox>;
    return frozen ? <GtkOverlay halign={Gtk.Align.START} overlays={frozen}>{cells}</GtkOverlay> : cells;
  }
  return (
    <GtkOverlay
      halign={Gtk.Align.START}
      controllers={<GtkGestureClick button={3} onPressed={() => button.current?.popup()} />}
      actionGroups={
        <GSimpleActionGroup
          prefix="row"
          actions={
            <>
              <GSimpleAction name="open" enabled={!!onOpenBody} onActivate={() => onOpenBody?.(rowId)} />
              <GSimpleAction name="above" enabled={canInsert} onActivate={() => onInsertRow?.(rowId, "above")} />
              <GSimpleAction name="below" enabled={canInsert} onActivate={() => onInsertRow?.(rowId, "below")} />
              <GSimpleAction name="fit" enabled={!!onFitRow} onActivate={() => onFitRow?.(rowId)} />
              <GSimpleAction name="reset-height" enabled={!!onResetRowHeight} onActivate={() => onResetRowHeight?.(rowId)} />
              <GSimpleAction name="delete" enabled={!!onDeleteRow} onActivate={() => onDeleteRow?.(rowId)} />
            </>
          }
        />
      }
      overlays={
        <>
        {frozen}
        <GtkMenuButton
          ref={(widget: Gtk.MenuButton | null) => {
            button.current = widget;
            menuRef?.(widget);
          }}
          opacity={0}
          canTarget={false}
          canFocus={false}
          halign={Gtk.Align.START}
          tooltipText="Row Actions"
          popover={
            <GtkPopoverMenu
              flags={Gtk.PopoverMenuFlags.NESTED}
              hasArrow={false}
              menuModel={<GMenu items={rowMenu(rowActions(rowId, { onOpenBody, hasBody, ...(canInsert ? { onInsertRow } : {}), onFitRow, onResetRowHeight, onDeleteRow }))} />}
            />
          }
        />
        </>
      }
    >
      <GtkBox halign={Gtk.Align.START} cssClasses={[styles.bodyRow]}>{children}</GtkBox>
    </GtkOverlay>
  );
}

/** How far down a table is (the row at the top of what's seen, and how far into it), and how far across from its start. */
export interface ScrollPlace {
  rowId: string;
  offset: number;
  across?: number;
}

/**
 * The table's props on GTK. It owns its scroller, so how far down it is
 * scrolled is its own to say (`onScrollPlace`) and to put back
 * (`restorePlace.place.top`), where the web's page does that for its table.
 */
export type GtkTableViewProps = ViewProps & {
  onScrollPlace?: (top: ScrollPlace) => void;
  restorePlace?: { place: { rowId?: string; field?: string; top?: ScrollPlace }; n: number } | null;
};

export function TableView({
  view,
  rows,
  schema,
  bodies,
  relatedTables,
  onUpdateRow,
  onUpdateView,
  onUpdateField,
  onAddEnumValue,
  onMoveField,
  onAddField,
  onDeleteField,
  onRemoveEnumValue,
  onRestoreSchema,
  newFieldRequest,
  onAddRow,
  onDeleteRow,
  onInsertRow,
  onOpenBody,
  onAttachFile,
  onOpenRelation,
  sheet,
  allRows,
  source: given,
  tableKey,
  onPlace,
  onScrollPlace,
  restorePlace,
}: GtkTableViewProps) {
  // A field's editor open, by name, and "add a field" open.
  const [editingField, setEditingField] = useState<string | null>(null);
  // The schema as it was when a field's editor opened, for its Cancel.
  const schemaBefore = useRef<typeof schema | null>(null);
  useEffect(() => {
    schemaBefore.current = editingField ? schema : null;
    // Only as an editor opens or closes: the schema changes under it as it edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingField]);
  // Where the new field goes: at the end, or beside a column (its menu's Insert Field Left or Right).
  const [addingField, setAddingField] = useState<false | { place?: { name: string; side: "before" | "after" } }>(false);
  // The app's New Field (its menu): the same editor, each time it's asked for.
  // (Counted from one: none yet is nothing to open, whichever view of the table this is.)
  const askedForField = useRef(newFieldRequest ?? 0);
  useEffect(() => {
    if (!newFieldRequest || newFieldRequest === askedForField.current) return;
    askedForField.current = newFieldRequest;
    if (onAddField) setAddingField({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFieldRequest]);
  const schemaEditable = !!(onUpdateField && onAddEnumValue && onMoveField);
  // The column whose About This Field is open (FieldAbout).
  const [aboutField, setAboutField] = useState<string | null>(null);
  // A formula cell opened to see how it was worked out (FormulaPanel).
  const [openFormula, setOpenFormula] = useState<{ rowId: string; name: string } | null>(null);
  // The row just added from "New Row": its first cell opens for typing.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const fields = visibleFields(view, schema);
  const fieldMap = fieldsByName(schema);
  const embedded = useEmbedded();
  const frameMargin = embedded ? 0 : WINDOW_FRAME_MARGIN;
  // Resizing: live sizes while a handle is dragged, saved to the view
  // (columnWidths, rowHeights; SPEC section 4) when it's let go, as on the web.
  const rtl = useDirection() === "rtl";
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [liveRow, setLiveRow] = useState<{ rowId: string; h: number; name: string; by: "grip" | "line" } | null>(null);
  const resizeFrom = useRef(0);
  // Each row's own height, else the view's default; the row being resized follows the drag.
  const heightOf = (rowId: string) => (liveRow?.rowId === rowId ? liveRow.h : rowHeightOf(view, rowId));
  const coords = view.coordinates === true;
  const groupField = view.group?.field;
  const source = useMemo(
    () =>
      given ??
      memoryViewRows(rows, { schema, ...(groupField !== undefined ? { group: groupField } : {}), ...(view.totals ? { totals: view.totals } : {}) }),
    [given, rows, schema, groupField, view.totals],
  );
  // Embedded and cut to a count, only the first rows are drawn; the totals and each group's count are still the whole view's.
  const cut = embedded?.cut === true && embedded.rows !== undefined;
  const count = drawnOf(embedded, embedded?.rows, source.count);
  // Where each row is, built or not: one height each, but for a group's
  // heading above its first row and the rows with a height of their own.
  const ownHeights = useMemo(
    () => [...new Set([...Object.keys(view.rowHeights ?? {}), ...(liveRow ? [liveRow.rowId] : [])])],
    [view.rowHeights, liveRow?.rowId],
  );
  const facts = useViewFacts(source, ownHeights);
  const defaultHeight = view.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const marks: RowMark[] = facts.groups.filter((g) => g.start < count).map((g) => ({ place: g.start, before: GROUP_ROW_HEIGHT }));
  for (const [id, place] of facts.places) if (place < count) marks.push({ place, taller: heightOf(id) - defaultHeight });
  const layout = rowLayout(count, defaultHeight + ROW_RULE, marks);
  const bodyHeight = layout.height;
  const groupStarts = new Map(facts.groups.map((g) => [g.start, g]));
  // The stretch of the body that is built, in pixels from its top. It moves
  // only when scrolling brings the screen's edge near its own, not on every
  // pixel scrolled.
  const scroller = useRef<Gtk.ScrolledWindow | null>(null);
  // `shift` is for a table taller than MAX_BODY_HEIGHT: how far the rows are
  // from where the scroller is, so the row at the scroller's `value + shift`
  // is the one at the top of the screen. Scrolling moves the rows a pixel a
  // pixel, with the shift as it is; a jump (the scrollbar dragged, a key
  // that goes far) sets it by how far down the scroller is, so the bar's
  // whole travel is the whole table.
  const [built, setBuilt] = useState({ from: 0, to: 3 * DRAW_DISTANCE, shift: 0 });
  const laidOut = Math.min(bodyHeight, MAX_BODY_HEIGHT);
  const lastValue = useRef(0);
  const shiftAt = (adjustment: Gtk.Adjustment, value: number) => {
    const range = Math.max(1, adjustment.getUpper() - adjustment.getPageSize());
    return (bodyHeight - laidOut) * Math.min(1, Math.max(0, value / range));
  };
  // How far down the table is, said for history once the scrolling rests (placeNow is set where the rows are known).
  const placeNow = useRef<(() => void) | null>(null);
  const topToRestore = useRef<number | null>(null);
  const restoreTopNow = useRef<(() => void) | null>(null);
  const placeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeSoon = () => {
    if (placeTimer.current) clearTimeout(placeTimer.current);
    placeTimer.current = setTimeout(() => placeNow.current?.(), 150);
  };
  useEffect(
    () => () => {
      if (placeTimer.current) clearTimeout(placeTimer.current);
    },
    [],
  );
  /** Scroll so that `wanted` (a distance down the whole table, header and all) is at the top of what's seen, building the rows there. */
  const scrollBodyTo = (wanted: number) => {
    const adjustment = scroller.current?.getVadjustment();
    if (!adjustment) return;
    const page = adjustment.getPageSize();
    const range = Math.max(1, adjustment.getUpper() - page);
    // value + shiftAt(value) = wanted, for a shift that grows evenly down the scroller.
    const value = bodyHeight <= MAX_BODY_HEIGHT ? Math.min(range, wanted) : Math.min(range, wanted / (1 + (bodyHeight - laidOut) / range));
    const shift = bodyHeight <= MAX_BODY_HEIGHT ? 0 : shiftAt(adjustment, value);
    const top = value + shift - HEADER_HEIGHT - ROW_RULE;
    setBuilt({ from: top - DRAW_DISTANCE, to: top + page + DRAW_DISTANCE, shift });
    lastValue.current = value;
    adjustment.setValue(value);
  };
  const follow = () => {
    const adjustment = scroller.current?.getVadjustment();
    if (!adjustment) return;
    placeSoon();
    const value = adjustment.getValue();
    const page = adjustment.getPageSize();
    const jumped = Math.abs(value - lastValue.current) > 3 * page;
    const atAnEnd = value <= 0 || value >= adjustment.getUpper() - page - 0.5;
    lastValue.current = value;
    setBuilt((was) => {
      const shift = bodyHeight <= MAX_BODY_HEIGHT ? 0 : jumped || atAnEnd ? shiftAt(adjustment, value) : Math.min(was.shift, bodyHeight - laidOut);
      const top = value + shift - HEADER_HEIGHT - ROW_RULE;
      const bottom = top + page;
      return shift === was.shift && (top - DRAW_MARGIN >= was.from || was.from <= 0) && (bottom + DRAW_MARGIN <= was.to || was.to >= bodyHeight)
        ? was
        : { from: top - DRAW_DISTANCE, to: bottom + DRAW_DISTANCE, shift };
    });
  };
  // The scroller isn't left to bring the focused cell into view itself: it
  // would go by where that cell was before its row was placed, and a wrong
  // move is a jump. revealCell does it, from where the row is known to be.
  // (The viewport is this table's own for that: `scrollToFocus` off.)
  const content = useRef<Gtk.Box | null>(null);
  // The frozen first column as it is now, for revealCell: how wide, and which cell of a row it is.
  // A sideways scroll the table makes itself: where it put the columns, and the timer of one under way.
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placedAcross = useRef<number | null>(null);
  const placeAcross = (across: Gtk.Adjustment, value: number) => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = null;
    placedAcross.current = value;
    across.setValue(value);
  };
  const frozenNow = useRef<{ width: number; cellOf?: (place: number) => Gtk.Widget | undefined }>({ width: 0 });
  const revealCell = (place: number, cell: Gtk.Widget | undefined) => {
    const window = scroller.current;
    if (!window) return;
    const down = window.getVadjustment();
    const top = layout.topOf(place) - built.shift + HEADER_HEIGHT + ROW_RULE;
    const bottom = top + layout.heightOf(place);
    let value = down.getValue();
    if (top < value) value = top;
    else if (bottom > value + down.getPageSize()) value = bottom - down.getPageSize();
    if (value !== down.getValue()) {
      // A step, not a jump: the rows stay where they are against the scroller.
      lastValue.current = value;
      down.setValue(value);
    }
    const [found, bounds] = cell && content.current ? cell.computeBounds(content.current) : [false, null];
    if (!found || !bounds) return;
    // The first column, when it stays put, is always in view, and covers that much of the others' start.
    if (frozenNow.current.width > 0 && cell === frozenNow.current.cellOf?.(place)) return;
    const covered = frozenNow.current.width;
    const across = window.getHadjustment();
    const page = across.getPageSize();
    // Across what is scrolled: the frame's margin and line come before the cells.
    const left = bounds.getX() + frameMargin + 1;
    const right = left + bounds.getWidth();
    let x = across.getValue();
    if (rtl) {
      // Right to left the first column is at the window's right, and it's the cell's right it covers.
      if (right > x + page - covered) x = Math.min(across.getUpper() - page, right - page + covered);
      else if (left < x) x = left;
    } else if (left - covered < x) x = Math.max(0, left - covered);
    else if (right > x + page) x = right - page;
    if (x !== across.getValue()) placeAcross(across, x);
  };
  const firstBuilt = Math.min(layout.at(built.from), Math.max(0, count - 1));
  const lastBuilt = Math.min(layout.at(built.to), count - 1);
  const before = count ? Math.max(0, layout.itemTop(firstBuilt) - built.shift) : 0;
  const after = count ? Math.max(0, laidOut - (layout.topOf(lastBuilt) + layout.heightOf(lastBuilt) - built.shift)) : 0;
  // The built rows: one that hasn't arrived from the index yet is undefined, and drawn empty.
  const builtRows = useViewWindow(source, firstBuilt, lastBuilt + 1);
  const builtPlace = new Map<string, number>();
  const builtRow = new Map<string, Row>();
  builtRows.forEach((row, i) => {
    if (!row) return;
    builtPlace.set(row.id, firstBuilt + i);
    builtRow.set(row.id, row);
  });
  const totals = view.totals ?? {};
  // The footer is there whenever a total could be chosen; with none chosen it is quiet (no rules), as on the web.
  // Not under a table cut to its first rows, though: an empty band there reads as part of what was left out.
  const quietTotals = Object.keys(totals).length === 0;
  const showTotals = !quietTotals || (!!onUpdateView && !(cut && source.count > count));
  const chooseTotal = (name: string, kind: ViewTotal | null) => {
    const next = { ...(view.totals ?? {}) };
    if (kind) next[name] = kind;
    else delete next[name];
    onUpdateView?.({ totals: Object.keys(next).length ? next : undefined });
  };

  // The visible width, from the scroller's own adjustment: its page size is
  // what's on screen, and it changes as the window or sidebar does.
  const [containerWidth, setContainerWidth] = useState(0);
  // Rows go above or below another only in a sheet (D41), and not when a sort places them.
  const canInsert = !!onInsertRow && isSheet(view) && canInsertAt(view);
  const hasMenu = !!onOpenBody || !!onDeleteRow || canInsert || !!onUpdateView;
  // The row menu's button sits after the last column: its room comes out
  // of the columns' share, so it stays on screen.
  // What the columns don't get: the frame and its margins, a sheet's row numbers, and the "+" after the last column.
  // A sheet's row numbers: their gutter is as wide as the largest of them (table-ui's rowNumberWidth), worked
  // out once from how many rows the view has and the sheet's own numbering, not from the rows on screen.
  const largestNumber = useMemo(() => {
    let most = source.count;
    if (sheet?.position) for (const n of sheet.position.values()) if (n > most) most = n;
    return most;
  }, [source.count, sheet?.position]);
  const numberWidth = coords ? rowNumberWidth(largestNumber) : 0;
  const chrome = TABLE_CHROME + 2 * frameMargin + numberWidth + (onAddField ? ADD_FIELD_WIDTH : 0);
  // A table that nearly fits is shown whole: its columns give a little before it scrolls sideways.
  const colWidth = columnWidths(fields, { ...(view.columnWidths ?? {}), ...liveWidths }, containerWidth, chrome, SQUEEZED_CELL_WIDTH);
  // On a wide window the first column (and a sheet's row numbers) stays put while the others scroll
  // sideways, as on the web and the Mac. Each row's first cell is laid over the row's start and moved
  // along with the scrolling, by its margin: the rows stay one scroller's, so nothing else changes.
  const freeze = fields.length > 1 && containerWidth > FREEZE_FROM_WIDTH;
  const frozenWidth = freeze ? numberWidth + colWidth(fields[0]!) : 0;
  const scrolledAcross = useRef(0);
  const pinned = useRef(new Map<string, { widget: Gtk.Widget; from: number }>());
  /** A ref for something that stays where it is across the table (`from` its start) however far it is scrolled. */
  const pin = (key: string, from = 0) => (widget: Gtk.Widget | null) => {
    if (!widget) return void pinned.current.delete(key);
    pinned.current.set(key, { widget, from });
    widget.setMarginStart(from + scrolledAcross.current);
  };
  // Scrolled sideways, the columns come to rest with one starting at the edge (the first column's end
  // when that stays put), so none is left cut in half there with its title out of sight. A scroll the
  // table makes itself, to bring a cell into view, stays where it was put.
  const snapNow = useRef<(() => void) | null>(null);
  snapNow.current = () => {
    const across = scroller.current?.getHadjustment();
    if (!across) return;
    // Counted from the table's start, whichever side that is.
    const value = acrossFromStart(across, rtl);
    const end = across.getUpper() - across.getPageSize();
    // At either end there's nothing to bring into line.
    if (value <= 0 || value >= end - 1) return;
    let nearest = 0;
    const nearer = (to: number) => {
      if (Math.abs(to - value) < Math.abs(nearest - value)) nearest = to;
    };
    // Where the table is scrolled to with each column in turn starting at the edge. The first is there
    // unscrolled, the frame's margin showing; one that starts past the end can't come to the edge.
    let at = frameMargin + 1 + (freeze ? 0 : numberWidth);
    for (const name of (freeze ? fields.slice(1) : fields).slice(0, -1)) {
      at += colWidth(name);
      if (at < end) nearer(at);
    }
    nearer(end);
    if (Math.abs(nearest - value) < 1) return;
    // A glide, not a jump: the eye follows the columns to where they rest.
    const started = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / SNAP_GLIDE_MS);
      placeAcross(across, acrossValue(across, rtl, t < 1 ? value + (nearest - value) * (1 - (1 - t) ** 3) : nearest));
      snapTimer.current = t < 1 ? setTimeout(step, 16) : null;
    };
    step();
  };
  useEffect(
    () => () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
    },
    [],
  );
  // How far across to put the table back (`restorePlace`). A view just shown has no width to scroll
  // yet, so this waits until it has: tried now, and again as the scroller grows.
  const acrossToRestore = useRef<number | null>(null);
  const restoreAcross = () => {
    const across = scroller.current?.getHadjustment();
    const wanted = acrossToRestore.current;
    if (wanted === null || !across || across.getUpper() - across.getPageSize() < wanted - 1) return;
    acrossToRestore.current = null;
    placeAcross(across, acrossValue(across, rtl, wanted));
  };
  /** Scrolled past the frame's margin and edge, the first column rests against the window's own edge. */
  const pinAcross = () => {
    const across = scroller.current?.getHadjustment();
    const x = freeze && across ? Math.max(0, Math.round(acrossFromStart(across, rtl)) - frameMargin - 1) : 0;
    if (x === scrolledAcross.current) return;
    scrolledAcross.current = x;
    for (const { widget, from } of pinned.current.values()) widget.setMarginStart(from + x);
    // A column's line that has gone under the first column can't be taken through it.
    for (const { widget, at } of columnLineWidgets.current.values()) widget.setVisible(at > x + frozenWidth);
  };
  const lastAcross = useRef(0);
  const scrollAcross = (value: number) => {
    // Right to left GTK says the value again after laying out, a hair off: that isn't a scroll.
    const moved = Math.abs(value - lastAcross.current) >= 0.01;
    lastAcross.current = value;
    if (!moved) return pinAcross();
    // Where it rests is said for history, with how far down it is.
    placeSoon();
    const placed = placedAcross.current;
    placedAcross.current = null;
    // Anyone else's scroll ends a glide, and is brought into line once it has been still a moment.
    if (placed === null || Math.abs(placed - value) >= 1) {
      acrossToRestore.current = null;
      if (snapTimer.current) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(() => snapNow.current?.(), SNAP_AFTER_MS);
    }
    pinAcross();
  };
  // What a row starts with: its frozen part laid over it and room left under that, or the gutter in line.
  // (It is its cells' height, at the top of its row or the foot of the totals: the row's own rule shows past it.)
  const rowStart = (key: string, height: number, classes: string[], number: string, firstCell: ReactNode, valign = Gtk.Align.START) =>
    freeze
      ? {
          frozen: (
            <GtkBox ref={pin(key)} halign={Gtk.Align.START} valign={valign} cssClasses={classes}>
              {gutter(number, height)}
              {firstCell}
            </GtkBox>
          ),
          inLine: <GtkBox widthRequest={frozenWidth} heightRequest={height} />,
        }
      : { frozen: undefined, inLine: gutter(number, height) };
  // A column that was dragged, back to its share of the width.
  const resetWidth = (name: string) => {
    if (!onUpdateView || view.columnWidths?.[name] === undefined) return;
    const { [name]: _gone, ...rest } = view.columnWidths;
    onUpdateView({ columnWidths: Object.keys(rest).length > 0 ? rest : undefined });
  };

  // A column's handle is on its end edge (the left, right to left, where
  // dragging leftwards widens it); a row's grip is on its bottom edge.
  // How far a drag has gone, across the window. GTK says a drag's offset against the widget it began
  // on, where that widget is now; these handles move as their column or row is resized, which takes the
  // movement back out of the offset (a handle that follows the pointer would seem not to have moved).
  // So it is measured against the window, which stays put. (A drag with no pointer behind it, as a test
  // makes, has no start to measure from: its offset is taken as it is.)
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const inWindow = (gesture: Gtk.GestureDrag, dx: number, dy: number) => {
    const [started, x, y] = gesture.getStartPoint();
    const widget = gesture.getWidget();
    const root = widget?.getRoot() as unknown as Gtk.Widget | null | undefined;
    if (!started || !widget || !root) return null;
    const [found, wx, wy] = widget.translateCoordinates(root, x + dx, y + dy);
    return found ? { x: wx, y: wy } : null;
  };
  const dragBegan = (gesture: Gtk.GestureDrag) => {
    dragFrom.current = inWindow(gesture, 0, 0);
  };
  const dragGone = (gesture: Gtk.GestureDrag, dx: number, dy: number): { dx: number; dy: number } => {
    const from = dragFrom.current;
    const now = from ? inWindow(gesture, dx, dy) : null;
    return from && now ? { dx: now.x - from.x, dy: now.y - from.y } : { dx, dy };
  };
  // Resizing a column, from its header's edge or from its line down the table: dragging sets its
  // width, and a double click puts it back to its share.
  const columnResize = (name: string) => {
    const widthAt = (dx: number) => resizedColumnWidth(resizeFrom.current, rtl ? -dx : dx);
    return [
      <GtkGestureClick key="click" onPressed={(presses) => presses === 2 && resetWidth(name)} />,
      <GtkGestureDrag
        key="drag"
        onDragBegin={(_x, _y, self) => {
          resizeFrom.current = colWidth(name);
          dragBegan(self);
        }}
        onDragUpdate={(dx, dy, self) => {
          const gone = dragGone(self, dx, dy);
          setLiveWidths((live) => ({ ...live, [name]: widthAt(gone.dx) }));
        }}
        onDragEnd={(dx, dy, self) => {
          const gone = dragGone(self, dx, dy);
          // A press that didn't move is a click, not a width.
          if (gone.dx !== 0) onUpdateView?.({ columnWidths: { ...(view.columnWidths ?? {}), [name]: widthAt(gone.dx) } });
          setLiveWidths({});
        }}
      />,
    ];
  };
  const columnHandle = (name: string) =>
    onUpdateView ? (
      <GtkBox
        name={`resize-column-${name}`}
        widthRequest={6}
        halign={Gtk.Align.END}
        cssClasses={[styles.columnHandle, ...(liveWidths[name] !== undefined ? [styles.columnHandleLit] : [])]}
        tooltipText="Drag to resize the column; double-click to reset it"
        cursor={Gdk.Cursor.newFromName("col-resize", null)}
        controllers={columnResize(name)}
      />
    ) : null;
  // With a pointer a column also resizes from its line anywhere down the table, as on the web and the
  // Mac: a strip over the rows at each column's end, faint when pointed at and full while dragged, as
  // its header's edge is. The first column's stays with it where that column stays put, and a line that
  // has scrolled under the first column is out of reach until it comes out.
  const columnLineWidgets = useRef(new Map<string, { widget: Gtk.Widget; at: number }>());
  const columnLines = () => {
    if (!onUpdateView) return null;
    let x = numberWidth;
    return fields.map((name, i) => {
      x += colWidth(name);
      const at = x;
      const stays = freeze && i === 0;
      return (
        <GtkBox
          key={name}
          name={`resize-column-line-${name}`}
          ref={(widget: Gtk.Box | null) => {
            if (stays) pin(`column-line:${name}`, at - COLUMN_LINE_BEFORE)(widget);
            if (!widget) return void columnLineWidgets.current.delete(name);
            if (stays) return void columnLineWidgets.current.delete(name);
            columnLineWidgets.current.set(name, { widget, at });
            widget.setVisible(!freeze || at > scrolledAcross.current + frozenWidth);
          }}
          halign={Gtk.Align.START}
          marginStart={at - COLUMN_LINE_BEFORE + (stays ? scrolledAcross.current : 0)}
          widthRequest={COLUMN_LINE_WIDTH}
          cssClasses={[styles.columnLine, ...(liveWidths[name] !== undefined ? [styles.columnLineLit] : [])]}
          tooltipText="Drag to resize the column; double-click to reset it"
          cursor={Gdk.Cursor.newFromName("col-resize", null)}
          controllers={columnResize(name)}
        />
      );
    });
  };
  const numberOf = (row: Row, index: number): number => rowNumber(sheet?.position, row.id, index);

  const gutter = (content: string, height: number) =>
    coords ? (
      <GtkLabel label={content} name="row-number" widthRequest={numberWidth} heightRequest={height} cssClasses={[styles.rowNumber]} />
    ) : null;

  const display = useDisplaySettings();
  const { formulaSyntax } = display;

  // Resizing a row, from its grip or from the line under it: dragging goes in whole lines, and a
  // double click fits the row to what it holds. `name` is the column the grip is under.
  const saveRowHeight = (rowId: string, h: number) => {
    if (h !== rowHeightOf(view, rowId)) onUpdateView?.({ rowHeights: { ...(view.rowHeights ?? {}), [rowId]: h } });
  };
  /** A row's height for what it holds: each cell's text in its column's width. */
  const fittedHeightOf = (row: Row) =>
    fittedRowHeight(
      fields.map((field) => ({
        show: describeCell(fieldMap.get(field), row[field], display, relatedTables),
        width: colWidth(field),
      })),
    );
  // From the row's menu: fit it, or put it back to the view's height.
  const fitRow = (rowId: string) => {
    const row = builtRow.get(rowId);
    if (row) saveRowHeight(rowId, fittedHeightOf(row));
  };
  const resetRowHeight = (rowId: string) => {
    if (!onUpdateView || view.rowHeights?.[rowId] === undefined) return;
    const { [rowId]: _gone, ...rest } = view.rowHeights;
    onUpdateView({ rowHeights: Object.keys(rest).length > 0 ? rest : undefined });
  };
  const rowResize = (row: Row, by: "grip" | "line", name: string) => {
    const saveHeight = (h: number) => saveRowHeight(row.id, h);
    return [
      <GtkGestureDrag
        key="drag"
        onDragBegin={(_x, _y, self) => {
          resizeFrom.current = heightOf(row.id);
          dragBegan(self);
        }}
        onDragUpdate={(dx, dy, self) => setLiveRow({ rowId: row.id, h: snappedRowHeight(resizeFrom.current, dragGone(self, dx, dy).dy), name, by })}
        onDragEnd={(dx, dy, self) => {
          saveHeight(snappedRowHeight(resizeFrom.current, dragGone(self, dx, dy).dy));
          setLiveRow(null);
        }}
      />,
      <GtkGestureClick
        key="fit"
        onPressed={(nPress) => {
          if (nPress === 2) saveHeight(fittedHeightOf(row));
        }}
      />,
    ];
  };
  /** How many lines a row being dragged by `by` has, for its label. */
  const draggedLines = (row: Row, by: "grip" | "line") => {
    if (liveRow?.rowId !== row.id || liveRow.by !== by) return null;
    const n = linesFor(liveRow.h);
    return `${n} ${n === 1 ? "line" : "lines"}`;
  };
  // A row's grip: only on the row with the selected cell (so nothing else
  // can be dragged by a scroll), at its bottom edge under the start of that
  // cell, so it is in view wherever the table has been scrolled.
  const rowGrip = (row: Row) => {
    const [selectedRow, selectedName] = focusedCell?.split("\u0000") ?? [];
    const dragged = liveRow?.rowId === row.id && liveRow.by === "grip";
    if (!onUpdateView || (selectedRow !== row.id && !dragged)) return null;
    const gripName = (selectedRow === row.id ? selectedName : liveRow?.name) ?? fields[0]!;
    let cellStart = numberWidth;
    for (const field of fields) {
      if (field === gripName) break;
      cellStart += colWidth(field);
    }
    const label = draggedLines(row, "grip");
    // The look is the viewer's (Display's "Resize handles"): a pill at the cell's start, or a short
    // bar centred on its bottom edge, ringed in the page's colour, as on the web and phones.
    const grabbers = display.resizeHandles === "grabbers";
    const at = grabbers ? cellStart + Math.round((colWidth(gripName) - GRABBER_WIDTH) / 2) : cellStart + 4;
    return (
      <GtkBox
        name="resize-row"
        // Under the first column where that stays put, the grip stays with it.
        ref={freeze && gripName === fields[0] ? pin("grip", at) : undefined}
        halign={Gtk.Align.START}
        valign={Gtk.Align.END}
        marginStart={at + (freeze && gripName === fields[0] ? scrolledAcross.current : 0)}
        marginBottom={grabbers ? 0 : 1}
        spacing={6}
      >
        <GtkBox
          name="resize-row-grip"
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          widthRequest={grabbers ? GRABBER_WIDTH : 28}
          heightRequest={grabbers ? GRABBER_HEIGHT : 8}
          cssClasses={[grabbers ? styles.rowGrabber : styles.rowGrip]}
          tooltipText="Drag to resize the row; double-click to fit it"
          cursor={Gdk.Cursor.newFromName("row-resize", null)}
          controllers={rowResize(row, "grip", gripName)}
        >
          {grabbers ? null : <GtkImage iconName="list-drag-handle-symbolic" pixelSize={8} hexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} />}
        </GtkBox>
        {label !== null ? <GtkLabel label={label} cssClasses={[styles.rowGripLabel]} /> : null}
      </GtkBox>
    );
  };
  // With a pointer a row also resizes from the line under it, anywhere along it, as a column does
  // from its line: a strip inside the row's bottom edge that lights when pointed at and while it is
  // dragged. The lines are counted at the row's start, in view however far across the table is.
  const rowLine = (row: Row) => {
    if (!onUpdateView) return null;
    const label = draggedLines(row, "line");
    return (
      <>
        <GtkBox
          name="resize-row-line"
          // As wide as the row's cells: like its rule, it stops at the last column.
          halign={Gtk.Align.START}
          widthRequest={numberWidth + fields.reduce((sum, field) => sum + colWidth(field), 0)}
          valign={Gtk.Align.END}
          heightRequest={ROW_LINE_HEIGHT}
          cssClasses={[styles.rowLine, ...(label !== null ? [styles.rowLineLit] : [])]}
          tooltipText="Drag to resize the row; double-click to fit it"
          cursor={Gdk.Cursor.newFromName("row-resize", null)}
          controllers={rowResize(row, "line", fields[0]!)}
        />
        {label !== null ? (
          <GtkLabel
            ref={pin("line-label", 8)}
            label={label}
            halign={Gtk.Align.START}
            valign={Gtk.Align.END}
            marginStart={8 + scrolledAcross.current}
            marginBottom={8}
            canTarget={false}
            cssClasses={[styles.rowGripLabel]}
          />
        ) : null}
      </>
    );
  };

  const headerCell = (name: string, i: number) => {
        const field: Field | undefined = fieldMap.get(name);
        const title = field?.title ?? name;
        // Right-click the header to read what the field is, insert a field beside it, put back a width that was dragged, or delete it.
        const menu = columnActions(name, {
          ...(onAddField ? { onInsertField: (beside: string, side: "before" | "after") => setAddingField({ place: { name: beside, side } }) } : {}),
          ...(onUpdateView && view.columnWidths?.[name] !== undefined ? { onResetWidth: resetWidth } : {}),
          ...(onDeleteField ? { onDeleteField } : {}),
          rtl,
        });
        return (
          <HeaderMenu
            key={name}
            actions={menu}
            onAbout={() => setAboutField(name)}
            overlays={columnHandle(name)}
            menuRef={(button) => {
              if (button) headerMenus.current.set(name, button);
              else headerMenus.current.delete(name);
            }}
          >
          <Cell width={colWidth(name)} height={HEADER_HEIGHT}>
            <GtkLabel
              label={coords ? `${columnLetter(i)} ${title}` : title}
              xalign={xalignOf(effectiveAlign(field))}
              hexpand
              ellipsize={Pango.EllipsizeMode.END}
              maxWidthChars={1}
              cssClasses={[styles.headerCell]}
              // What the column is, as the web's header hint says it (table-ui's fieldHint).
              tooltipText={fieldHintText(fieldHint({ field, name, schema, editable: schemaEditable, formulaSyntax }))}
              // A header opens its field's editor, where the schema can be edited.
              controllers={schemaEditable ? <GtkGestureClick onReleased={() => setEditingField(name)} /> : undefined}
            />
          </Cell>
          </HeaderMenu>
        );
  };
  const headerStart = rowStart("header", HEADER_HEIGHT, [styles.frozenHeader], "", freeze ? headerCell(fields[0]!, 0) : null);
  const header = (
    <GtkBox>
    <GtkOverlay overlays={headerStart.frozen}>
    <GtkBox cssClasses={[styles.headerRow]}>
      {headerStart.inLine}
      {(freeze ? fields.slice(1) : fields).map((name, i) => headerCell(name, freeze ? i + 1 : i))}
    </GtkBox>
    </GtkOverlay>
      {/* The "+" for a new field: after the last column, outside the table's lines, faint until pointed at. */}
      {onAddField ? (
        <GtkButton
          iconName="list-add-symbolic"
          cssClasses={["flat", "circular", styles.addPlace]}
          valign={Gtk.Align.CENTER}
          halign={Gtk.Align.CENTER}
          // A cell of its own, ADD_FIELD_WIDTH wide, as on the web and the Mac.
          marginStart={3}
          marginEnd={3}
          widthRequest={ADD_FIELD_WIDTH - 6}
          tooltipText="Add Field"
          onClicked={() => setAddingField({})}
        />
      ) : null}
    </GtkBox>
  );
  // What follows the last real column (the "+"): a group's band and the new-row band stop short of it.
  const trailing = onAddField ? <GtkBox widthRequest={ADD_FIELD_WIDTH} /> : null;
  // The group's field, as its bands say it: "CITY · MANCHESTER".
  const groupTitle = groupField !== undefined ? (fieldMap.get(groupField)?.title ?? groupField) : "";
  // Each row's menu and each column's, to open from the keyboard.
  const rowMenus = useRef(new Map<string, Gtk.MenuButton>());
  const headerMenus = useRef(new Map<string, Gtk.MenuButton>());

  const editable = !!onUpdateRow;

  // The keyboard in the grid: the focused cell is the one it's on, and
  // what each key does is table-ui/shared's gridKey, as the web's is.
  const cells = useRef(new Map<string, Gtk.Box>());
  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  frozenNow.current = {
    width: frozenWidth,
    cellOf: (place) => {
      const id = builtRows[place - firstBuilt]?.id;
      return id === undefined ? undefined : cells.current.get(`${id}\u0000${fields[0]}`);
    },
  };
  // A cell asked to open for editing. It clears once the cell has heard it
  // (the cell's effect runs first), so the cell doesn't open again when its
  // row is scrolled away and built anew.
  const [editRequest, setEditRequest] = useState<{ key: string; n: number; text?: string } | null>(null);
  useEffect(() => {
    if (editRequest) setEditRequest(null);
  }, [editRequest]);
  const cellKey = (rowId: string, name: string) => `${rowId}\u0000${name}`;
  // A place to take the focus once its row is built.
  const focusWhenBuilt = useRef<GridPlace | null>(null);
  const focusCell = (at: GridPlace) => {
    const rowId = builtRows[at.row - firstBuilt]?.id;
    const name = fields[at.col];
    if (name === undefined || at.row < 0 || at.row >= count) return;
    const cell = rowId === undefined ? undefined : cells.current.get(cellKey(rowId, name));
    if (cell) {
      cell.grabFocus();
      return;
    }
    // Not built: scroll to its row, which builds it, and focus it then.
    const adjustment = scroller.current?.getVadjustment();
    if (!adjustment) return;
    focusWhenBuilt.current = at;
    const page = adjustment.getPageSize();
    // Where the scroller would be with the row in the middle of the screen, were the body its full height.
    scrollBodyTo(Math.max(0, layout.topOf(at.row) + HEADER_HEIGHT + ROW_RULE - (page - layout.heightOf(at.row)) / 2));
  };
  useLayoutEffect(() => {
    const at = focusWhenBuilt.current;
    if (!at) return;
    const rowId = builtRows[at.row - firstBuilt]?.id;
    const cell = rowId === undefined ? undefined : cells.current.get(cellKey(rowId, fields[at.col]!));
    if (!cell) return;
    focusWhenBuilt.current = null;
    cell.grabFocus();
  });
  // Where you are, for history: the cell the keyboard is on, said as it changes, and how far
  // down the table is. Going back to the view puts both back (`restorePlace`).
  const placeReport = useRef(onPlace);
  placeReport.current = onPlace;
  useEffect(() => {
    const [rowId, name] = focusedCell?.split("\u0000") ?? [];
    placeReport.current?.(rowId && name ? { rowId, field: name } : {});
    // Again for a new view: the app starts each view's place afresh.
  }, [focusedCell, view.id]);
  placeNow.current = () => {
    const adjustment = scroller.current?.getVadjustment();
    if (!adjustment || !onScrollPlace || count === 0) return;
    const y = Math.max(0, adjustment.getValue() + built.shift - HEADER_HEIGHT - ROW_RULE);
    const place = Math.min(layout.at(y), count - 1);
    const rowId = builtRows[place - firstBuilt]?.id;
    const across = scroller.current ? Math.round(acrossFromStart(scroller.current.getHadjustment(), rtl)) : 0;
    if (rowId !== undefined) onScrollPlace({ rowId, offset: Math.round(y - layout.itemTop(place)), ...(across > 0 ? { across } : {}) });
  };
  // A cell to take the keyboard if the rows a restored scroll built include it: going to it mustn't move the table again.
  const focusIfBuilt = useRef<GridPlace | null>(null);
  // How far down to put the table back. A view just shown isn't laid out yet (its scroller has no
  // length to scroll), so this waits until it is: tried now, and again as the scroller grows.
  restoreTopNow.current = () => {
    const wanted = topToRestore.current;
    const adjustment = scroller.current?.getVadjustment();
    if (wanted === null || !adjustment) return;
    const page = adjustment.getPageSize();
    if (adjustment.getUpper() - page < Math.min(wanted, laidOut + HEADER_HEIGHT - page) - 1) return;
    topToRestore.current = null;
    scrollBodyTo(wanted);
  };
  const restoreTop = () => restoreTopNow.current?.();
  useEffect(() => {
    const place = restorePlace?.place;
    if (!place) return;
    let current = true;
    void (async () => {
      const col = place.field ? fields.indexOf(place.field) : -1;
      const row = place.rowId && col >= 0 ? await source.placeOf(place.rowId) : -1;
      const top = place.top ? await source.placeOf(place.top.rowId) : -1;
      if (!current) return;
      if (place.top?.across) {
        acrossToRestore.current = place.top.across;
        restoreAcross();
      }
      if (place.top && top >= 0) {
        topToRestore.current = layout.itemTop(top) + place.top.offset + HEADER_HEIGHT + ROW_RULE;
        focusIfBuilt.current = row >= 0 ? { row, col } : null;
        restoreTop();
      } else if (row >= 0) focusCell({ row, col });
    })();
    return () => {
      current = false;
    };
    // Each place once, as it arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restorePlace?.n]);
  useLayoutEffect(() => {
    const at = focusIfBuilt.current;
    if (!at) return;
    if (at.row < firstBuilt || at.row > lastBuilt) return void (focusIfBuilt.current = null);
    const rowId = builtRows[at.row - firstBuilt]?.id;
    const cell = rowId === undefined ? undefined : cells.current.get(cellKey(rowId, fields[at.col]!));
    if (!cell) return;
    focusIfBuilt.current = null;
    cell.grabFocus();
  });
  const placeOf = (key: string): GridPlace | null => {
    const [rowId, name] = key.split("\u0000") as [string, string];
    const row = builtPlace.get(rowId) ?? -1;
    const col = fields.indexOf(name);
    return row < 0 || col < 0 ? null : { row, col };
  };
  // A row just added: gone to, wherever the view's order put it.
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    const id = reveal.current;
    if (!id) return;
    let current = true;
    void Promise.resolve(source.placeOf(id)).then((place) => {
      if (!current || place < 0) return;
      reveal.current = null;
      focusCell({ row: place, col: 0 });
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  const onGridKey = (keyval: number, state: number): boolean => {
    // Only a cell itself: typing in an editor, or on a button in a cell, is theirs.
    const focus = (cells.current.values().next().value?.getRoot() as Gtk.Window | undefined)?.getFocus();
    const key = [...cells.current].find(([, widget]) => widget === focus)?.[0];
    // The Menu key, or Shift+F10: the row's menu, as a right-click opens it.
    if (key && (keyval === Gdk.KEY_Menu || (keyval === Gdk.KEY_F10 && (state & Gdk.ModifierType.SHIFT_MASK) !== 0))) {
      const menu = rowMenus.current.get(key.split("\u0000")[0]!);
      if (!menu) return false;
      menu.popup();
      return true;
    }
    // Alt+Down: the menu of the column the cell is in, as a right-click on its header opens it.
    if (key && keyval === Gdk.KEY_Down && (state & Gdk.ModifierType.ALT_MASK) !== 0) {
      const menu = headerMenus.current.get(key.split("\u0000")[1]!);
      if (!menu) return false;
      menu.popup();
      return true;
    }
    const k = gridKeyOf(keyval, state);
    if (!key || !k) return false;
    const at = placeOf(key);
    if (!at) return false;
    const [rowId] = key.split("\u0000") as [string];
    const name = fields[at.col]!;
    const field = fieldMap.get(name);
    const row = builtRow.get(rowId);
    // Right to left, Left and Right are where they are on screen.
    const action = gridKey(at, count, fields.length, rtl ? mirroredKey(k) : k, {
      editable: editable && editorKind(field) !== "readonly",
      boolean: field?.type === "boolean",
      picks: cellPicks(field),
      computed: !!field?.computed,
    });
    if (!action || action.kind === "leave") return false;
    switch (action.kind) {
      case "select":
        focusCell(action.at);
        break;
      case "deselect":
        (focus as Gtk.Widget | null)?.getRoot()?.setFocus?.(null);
        break;
      case "clear":
        onUpdateRow!(rowId, name, undefined);
        break;
      case "toggle":
        onUpdateRow!(rowId, name, !(row?.[name] === true));
        break;
      case "open":
        if (field?.computed) setOpenFormula({ rowId, name });
        else setEditRequest({ key, n: Date.now(), ...(action.text !== undefined ? { text: action.text } : {}) });
        break;
    }
    return true;
  };
  // Typed and shown against the grid as saved, so =C3 means the same row
  // whatever this reader's sort or search (D41).
  // Only rows in memory have a grid to type formulas against (Sheet views are never indexed).
  const grid = viewGrid(view, fields, isImmediate(source) ? (source.ids(0, count) as string[]) : [], sheet);
  const openField = openFormula ? fieldMap.get(openFormula.name) : undefined;
  // While a formula is open: its column tinted, the cells it read outlined.
  const inputCells = openFormula ? formulaInputCells(openField, openFormula.rowId, view, fields, sheet?.order) : new Set<string>();

  const body = builtRows.map((row, i) => {
    const index = firstBuilt + i;
    const group = groupStarts.get(index);
    const starts = group ? { label: groupLabel(group.key, groupField!, schema), count: group.count } : undefined;
    const heading = starts ? (
      <GtkBox>
        <GtkBox hexpand heightRequest={GROUP_ROW_HEIGHT} cssClasses={[styles.groupRow]}>
          {/* What the band says stays at the table's start as the columns scroll under it. */}
          <GtkBox ref={pin(`group:${index}`)} spacing={8}>
            <GtkLabel label={`${groupTitle} · ${starts.label}`} xalign={0} cssClasses={[styles.groupLabel]} />
            <GtkLabel label={String(starts.count)} cssClasses={[styles.groupCount]} />
          </GtkBox>
        </GtkBox>
        {trailing}
      </GtkBox>
    ) : null;
    // On its way from the index: an empty row of its height in the table's own columns, with the cells
    // and lines a row has, so the grid stays whole and only the values arrive, and nothing moves.
    if (!row) {
      // Its place's height is the row's cells and its line.
      const height = layout.heightOf(index) - ROW_RULE;
      const empty = (name: string) => (
        <Cell key={name} width={colWidth(name)} height={height}>
          {null}
        </Cell>
      );
      const start = rowStart(`awaited:${index}`, height, [styles.frozen], "", freeze ? empty(fields[0]!) : null);
      return (
        <GtkBox key={`empty-${index}`} name="awaited-row" orientation={Gtk.Orientation.VERTICAL}>
          {heading}
          <BodyRow rowId="" menu={false} hasBody={false} canInsert={false} frozen={start.frozen}>
            {start.inLine}
            {(freeze ? fields.slice(1) : fields).map(empty)}
          </BodyRow>
        </GtkBox>
      );
    }
    const rowHeight = heightOf(row.id);
    const lines = linesFor(rowHeight);
    const bodyCell = (name: string, i: number) => {
          const field = fieldMap.get(name);
          const xalign = xalignOf(effectiveAlign(field));
          return (
            <Cell
              key={name}
              width={colWidth(name)}
              height={rowHeight}
              classes={[
                ...(openFormula?.name === name ? [styles.formulaColumn] : []),
                ...(inputCells.has(`${row.id}\u0000${name}`) ? [styles.formulaInput] : []),
                ...(focusedCell === cellKey(row.id, name) ? [styles.selectedCell] : []),
              ]}
              cellRef={(widget) => {
                if (widget) cells.current.set(cellKey(row.id, name), widget);
                else cells.current.delete(cellKey(row.id, name));
              }}
              onFocused={(focused) => {
                if (focused) revealCell(index, cells.current.get(cellKey(row.id, name)));
                setFocusedCell((was) => (focused ? cellKey(row.id, name) : was === cellKey(row.id, name) ? null : was));
              }}
            >
              <GtkBox
                spacing={6}
                hexpand
                valign={lines > 1 ? Gtk.Align.START : Gtk.Align.CENTER}
                marginTop={lines > 1 ? 10 : 0}
                // A formula cell opens how it was worked out; its value isn't typed.
                controllers={
                  field?.computed ? <GtkGestureClick onReleased={() => setOpenFormula({ rowId: row.id, name })} /> : undefined
                }
                tooltipText={field?.computed ? "How This Was Worked Out" : undefined}
              >
                {editable ? (
                  <EditableCell
                    field={field}
                    value={row[name]}
                    onCommit={(next) => onUpdateRow!(row.id, name, next)}
                    relatedTables={relatedTables}
                    onOpenRelation={onOpenRelation}
                    lines={lines}
                    xalign={xalign}
                    autoEdit={i === 0 && row.id === justAdded}
                    editRequest={editRequest?.key === cellKey(row.id, name) ? editRequest : undefined}
                    // Editing closed from the keyboard: the grid takes it back, where Enter or Tab leads.
                    onEditEnd={(how) => {
                      const at = placeOf(cellKey(row.id, name));
                      if (at) focusCell(afterEdit(at, how, count, fields.length));
                    }}
                    onAttach={onAttachFile ? () => onAttachFile(row.id, name) : undefined}
                  />
                ) : (
                  <CellValue
                    field={field}
                    value={row[name]}
                    relatedTables={relatedTables}
                    onOpenRelation={onOpenRelation}
                    lines={lines}
                    xalign={xalign}
                  />
                )}
                {i === 0 && bodies?.[row.id] !== undefined && onOpenBody ? (
                  <GtkButton
                    label="Page"
                    cssClasses={["flat", styles.pageBadge]}
                    valign={Gtk.Align.CENTER}
                    tooltipText="This row has a page. Click to open it."
                    onClicked={() => onOpenBody(row.id)}
                  />
                ) : null}
              </GtkBox>
            </Cell>
          );
    };
    const start = rowStart(`row:${row.id}`, rowHeight, [styles.frozen], String(numberOf(row, index)), freeze ? bodyCell(fields[0]!, 0) : null);
    return (
    <GtkBox key={row.id} orientation={Gtk.Orientation.VERTICAL}>
      {heading}
      <GtkOverlay
        overlays={
          <>
            {rowLine(row)}
            {rowGrip(row)}
          </>
        }
      >
      <BodyRow
        rowId={row.id}
        menu={hasMenu}
        hasBody={bodies?.[row.id] !== undefined}
        canInsert={canInsert}
        onOpenBody={onOpenBody}
        onDeleteRow={onDeleteRow}
        onInsertRow={onInsertRow}
        onFitRow={onUpdateView ? fitRow : undefined}
        onResetRowHeight={onUpdateView && view.rowHeights?.[row.id] !== undefined ? resetRowHeight : undefined}
        menuRef={(button) => {
          if (button) rowMenus.current.set(row.id, button);
          else rowMenus.current.delete(row.id);
        }}
        frozen={start.frozen}
      >
        {start.inLine}
        {(freeze ? fields.slice(1) : fields).map((name, i) => bodyCell(name, freeze ? i + 1 : i))}
      </BodyRow>
      </GtkOverlay>
    </GtkBox>
    );
  });

  // "New Row" is open space under the last row: a band as wide as the real
  // columns with no lines through it, faint until pointed at.
  const addRow = onAddRow ? (
    <GtkBox>
      <GtkButton
        hexpand
        cssClasses={["flat", styles.addRowBand]}
        onClicked={() => {
          const id = onAddRow();
          if (typeof id === "string") {
            setJustAdded(id);
            reveal.current = id;
          }
        }}
      >
        <GtkLabel ref={pin("new-row")} label="+ New row" xalign={0} halign={Gtk.Align.START} />
      </GtkButton>
      {trailing}
    </GtkBox>
  ) : null;

  const totalCell = (name: string) => {
        const kind = totals[name];
        const field = fieldMap.get(name);
        const total = kind ? shownTotal(facts.totals[name], kind) : undefined;
        const xalign = xalignOf(effectiveAlign(field));
        const content =
          kind && total ? (
            // As wide as the cell's inside: the value has the room its column gives it, and ellipsizes past that.
            <GtkBox hexpand widthRequest={Math.max(0, colWidth(name) - 34)}>
              <GtkLabel label={TOTAL_LABELS[kind]} cssClasses={[styles.totalLabel]} />
              {total.numeric ? (
                <CellValue field={field} value={total.value} relatedTables={relatedTables} lines={1} xalign={1} />
              ) : (
                <GtkLabel label={String(total.value ?? "")} cssClasses={[styles.tabular]} />
              )}
            </GtkBox>
          ) : onUpdateView ? (
            // A place a total could go: seen when the cell is pointed at.
            <GtkLabel label="Calculate" xalign={xalign} hexpand widthRequest={Math.max(0, colWidth(name) - 34)} cssClasses={[styles.totalPlaceholder]} />
          ) : (
            <GtkLabel label="" />
          );
        if (!onUpdateView) {
          return (
            <Cell key={name} width={colWidth(name)} height={HEADER_HEIGHT}>
              {content}
            </Cell>
          );
        }
        // The cell is the menu of what can be worked out under its column.
        const kinds = totalKindsFor(field);
        return (
          <GtkMenuButton
            key={name}
            widthRequest={colWidth(name)}
            heightRequest={HEADER_HEIGHT}
            hexpand={false}
            cssClasses={["flat", styles.totalCell, ...(quietTotals ? [] : [styles.columnRule])]}
            tooltipText={`Calculate ${field?.title ?? name}`}
            actionGroups={
              <GSimpleActionGroup
                prefix="total"
                actions={
                  <>
                    {/* Each carries whether it is the one chosen, which the menu draws as a tick beside it. */}
                    <GSimpleAction name="none" state={GLib.Variant.newBoolean(!totals[name])} onActivate={() => chooseTotal(name, null)} />
                    {kinds.map((k) => (
                      <GSimpleAction key={k} name={k} state={GLib.Variant.newBoolean(totals[name] === k)} onActivate={() => chooseTotal(name, k)} />
                    ))}
                  </>
                }
              />
            }
            popover={
              <GtkPopoverMenu
                hasArrow={false}
                menuModel={
                  <GMenu
                    items={[
                      { section: [{ label: "None", action: "total.none" }] },
                      { section: kinds.map((k) => ({ label: TOTAL_NAMES[k], action: `total.${k}` })) },
                    ]}
                  />
                }
              />
            }
          >
            {content}
          </GtkMenuButton>
        );
  };
  const footerStart = rowStart("footer", HEADER_HEIGHT, [styles.frozen], "", freeze && showTotals ? totalCell(fields[0]!) : null, Gtk.Align.END);
  const footer = showTotals ? (
    <GtkOverlay overlays={footerStart.frozen}>
    <GtkBox cssClasses={[quietTotals ? styles.totalsRowQuiet : styles.totalsRow]}>
      {footerStart.inLine}
      {(freeze ? fields.slice(1) : fields).map((name) => totalCell(name))}
    </GtkBox>
    </GtkOverlay>
  ) : null;

  return (
    <GtkScrolledWindow
      ref={scroller}
      hexpand
      // Embedded and asked for so many rows: the header and those rows (and the headings of their groups), when there are more.
      // Cut to them, it is as tall as what it draws, and nothing scrolls.
      {...scrollerHeight(embedded, cut ? NO_LIMIT : embedded?.rows !== undefined && count > embedded.rows ? HEADER_HEIGHT + ROW_RULE + layout.itemTop(embedded.rows) : null)}
      cssClasses={[styles.table]}
      vadjustment={<GtkAdjustment onNotifyValue={follow} onNotifyPageSize={follow} onNotifyUpper={() => restoreTopNow.current?.()} />}
      hadjustment={
        <GtkAdjustment
          onNotifyPageSize={(size) => {
            setContainerWidth(Math.floor(size ?? 0));
            pinAcross();
            restoreAcross();
          }}
          // Right to left, how far it is scrolled from its start changes with its width too.
          onNotifyUpper={() => {
            pinAcross();
            restoreAcross();
          }}
          onNotifyValue={(value) => scrollAcross(value ?? 0)}
        />
      }
    >
      <GtkViewport scrollToFocus={false}>
      <GtkBox
        ref={content}
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.START}
        valign={Gtk.Align.START}
        // The table is a framed card in the window, as it is on the web and the Mac.
        cssClasses={[styles.tableFrame]}
        overflow={Gtk.Overflow.HIDDEN}
        marginStart={frameMargin}
        marginEnd={frameMargin}
        marginTop={frameMargin}
        marginBottom={frameMargin}
        controllers={<GtkEventControllerKey onKeyPressed={(keyval, _code, state) => onGridKey(keyval, state)} />}
      >
        {header}
        <GtkOverlay overlays={<>{columnLines()}</>}>
          <GtkBox orientation={Gtk.Orientation.VERTICAL}>
            {before > 0 ? <GtkBox heightRequest={before} /> : null}
            {body}
            {after > 0 ? <GtkBox heightRequest={after} /> : null}
          </GtkBox>
        </GtkOverlay>
        {addRow}
        {footer}
      </GtkBox>
      </GtkViewport>
      {openFormula && openField ? (() => {
        const openRow = builtRow.get(openFormula.rowId) ?? rows.find((r) => r.id === openFormula.rowId);
        if (!openRow) return null;
        return (
          <FormulaPanel
            key={`${openFormula.rowId}\u0000${openFormula.name}`}
            field={openField}
            row={openRow}
            fields={schema.fields}
            relatedTables={relatedTables}
            onSave={onUpdateField ? (patch) => onUpdateField(openFormula.name, patch) : undefined}
            onClose={() => setOpenFormula(null)}
            grid={grid ? { ...grid, here: openFormula.rowId } : undefined}
            allRows={allRows}
            computeOptions={{ tables: relatedTables, self: tableKey }}
          />
        );
      })() : null}
      {aboutField ? (
        <FieldAbout
          key={aboutField}
          field={fieldMap.get(aboutField)}
          name={aboutField}
          schema={schema}
          onSettings={
            schemaEditable
              ? () => {
                  setEditingField(aboutField);
                  setAboutField(null);
                }
              : undefined
          }
          onClose={() => setAboutField(null)}
        />
      ) : null}
      {editingField && schemaEditable ? (() => {
        const field = schema.fields.find((f) => f.name === editingField);
        if (!field) return null;
        return (
          <FieldEditor
            key={editingField}
            field={field}
            fieldIndex={schema.fields.indexOf(field)}
            totalFields={schema.fields.length}
            fields={schema.fields}
            grid={grid}
            onUpdate={(patch) => onUpdateField!(editingField, patch)}
            onAddChoice={(value) => onAddEnumValue!(editingField, value)}
            onRemoveChoice={onRemoveEnumValue ? (value) => onRemoveEnumValue(editingField, value) : undefined}
            onDelete={
              onDeleteField
                ? () => {
                    setEditingField(null);
                    onDeleteField(editingField);
                  }
                : undefined
            }
            onCancel={
              onRestoreSchema
                ? () => {
                    if (schemaBefore.current) onRestoreSchema(schemaBefore.current);
                    setEditingField(null);
                  }
                : undefined
            }
            onMove={(delta) => onMoveField!(editingField, delta)}
            onClose={() => setEditingField(null)}
          />
        );
      })() : null}
      {addingField && onAddField ? (
        <AddField
          existing={new Set(schema.fields.map((f) => f.name))}
          fields={schema.fields}
          grid={grid}
          onAdd={(field) => onAddField(field, addingField.place)}
          onClose={() => setAddingField(false)}
        />
      ) : null}
    </GtkScrolledWindow>
  );
}
