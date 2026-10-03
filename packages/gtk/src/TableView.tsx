// The table layout on GTK: a header of field titles, a row per record at
// the view's row height, group headings when the view groups, and the
// totals footer. Columns are sized by the same rule as the web grid
// (`columnWidths`), so a view saved on one looks the same on the other.
//
// Plain boxes rather than GtkColumnView, as the web grid is plain elements:
// every row is built. Large tables (docs/LARGE-TABLES.md) will want the
// recycling list instead; the cells stay as they are when that comes.

import * as Gdk from "@gtkx/gi/gdk";
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
} from "@gtkx/jsx/gtk";
import type { MenuItem } from "@gtkx/react/internal";
import { columnLetter, effectiveAlign, isSheet, type Field, type FieldAlignment, type Row } from "@workspace.sh/table-core";
import {
  canInsertAt,
  describeCell,
  fittedRowHeight,
  formulaInputCells,
  viewGrid,
  columnWidths,
  fieldsByName,
  groupedRows,
  linesFor,
  ROW_NUMBER_WIDTH,
  TOTAL_LABELS,
  totalFor,
  visibleFields,
  type ViewProps,
  rowNumber,
  fieldHint,
  fieldHintText,
  rowActions,
  type RowAction,
  resizedColumnWidth,
  rowHeightOf,
  snappedRowHeight,
  useDirection,
  afterEdit,
  cellPicks,
  editorKind,
  gridKey,
  type GridPlace,
  useDisplaySettings,
} from "@workspace.sh/table-ui/shared";
import { useRef, useState, type ReactNode } from "react";
import { CellValue } from "./CellValue.js";
import { EditableCell } from "./EditableCell.js";
import { AddField, FieldEditor } from "./FieldEditor.js";
import { FormulaPanel } from "./FormulaPanel.js";
import { styles } from "./theme.js";
import { gridKeyOf } from "./gridKeys.js";

/** The web grid's rule for the chrome: its two outer borders. */
const TABLE_CHROME = 2;
const HEADER_HEIGHT = 36;
/** A row menu's circular button and its margin. */
const ROW_MENU_WIDTH = 42;

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
  delete: "row.delete",
};

/**
 * The row menu: table-ui/shared's rowActions, with the same labels as
 * on the web, the Mac and phones, in sections: the page, inserting,
 * deleting.
 */
function rowMenu(actions: RowAction[]): MenuItem[] {
  const section = (ids: RowAction["id"][]) => actions.filter((a) => ids.includes(a.id)).map((a) => ({ label: a.label, action: ROW_ACTION[a.id] }));
  return [section(["open-page", "add-page"]), section(["insert-above", "insert-below"]), section(["delete"])]
    .filter((items) => items.length > 0)
    .map((items) => ({ section: items }));
}

/**
 * A body row, with its menu. The menu is a button at the row's end as well
 * as a right-click anywhere on the row: GNOME has no menu bar, and a
 * right-click alone isn't discoverable. Its actions live on the row, so
 * both reach the same items.
 */
function BodyRow({
  rowId,
  menu,
  hasBody,
  canInsert,
  onOpenBody,
  onDeleteRow,
  onInsertRow,
  children,
}: {
  rowId: string;
  menu: boolean;
  hasBody: boolean;
  canInsert: boolean;
  onOpenBody?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
  onInsertRow?: (anchor: string, where: "above" | "below") => void;
  children: ReactNode;
}) {
  const button = useRef<Gtk.MenuButton | null>(null);
  if (!menu) return <GtkBox cssClasses={[styles.bodyRow]}>{children}</GtkBox>;
  return (
    <GtkBox
      cssClasses={[styles.bodyRow]}
      controllers={<GtkGestureClick button={3} onPressed={() => button.current?.popup()} />}
      actionGroups={
        <GSimpleActionGroup
          prefix="row"
          actions={
            <>
              <GSimpleAction name="open" enabled={!!onOpenBody} onActivate={() => onOpenBody?.(rowId)} />
              <GSimpleAction name="above" enabled={canInsert} onActivate={() => onInsertRow?.(rowId, "above")} />
              <GSimpleAction name="below" enabled={canInsert} onActivate={() => onInsertRow?.(rowId, "below")} />
              <GSimpleAction name="delete" enabled={!!onDeleteRow} onActivate={() => onDeleteRow?.(rowId)} />
            </>
          }
        />
      }
    >
      {children}
      <GtkMenuButton
        ref={button}
        iconName="view-more-symbolic"
        cssClasses={["flat", "circular"]}
        valign={Gtk.Align.CENTER}
        marginStart={4}
        tooltipText="Row Actions"
        popover={
          <GtkPopoverMenu
            flags={Gtk.PopoverMenuFlags.NESTED}
            hasArrow={false}
            menuModel={<GMenu items={rowMenu(rowActions(rowId, { onOpenBody, hasBody, ...(canInsert ? { onInsertRow } : {}), onDeleteRow }))} />}
          />
        }
      />
    </GtkBox>
  );
}

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
  onAddRow,
  onDeleteRow,
  onInsertRow,
  onOpenBody,
  onAttachFile,
  onOpenRelation,
  sheet,
  allRows,
  tableKey,
}: ViewProps) {
  // A field's editor open, by name, and "add a field" open.
  const [editingField, setEditingField] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const schemaEditable = !!(onUpdateField && onAddEnumValue && onMoveField);
  // A formula cell opened to see how it was worked out (FormulaPanel).
  const [openFormula, setOpenFormula] = useState<{ rowId: string; name: string } | null>(null);
  // The row just added from "New Row": its first cell opens for typing.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const fields = visibleFields(view, schema);
  const fieldMap = fieldsByName(schema);
  // Resizing: live sizes while a handle is dragged, saved to the view
  // (columnWidths, rowHeights; SPEC section 4) when it's let go, as on the web.
  const rtl = useDirection() === "rtl";
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const [liveRow, setLiveRow] = useState<{ rowId: string; h: number; name: string } | null>(null);
  const resizeFrom = useRef(0);
  // Each row's own height, else the view's default; the row being resized follows the drag.
  const heightOf = (rowId: string) => (liveRow?.rowId === rowId ? liveRow.h : rowHeightOf(view, rowId));
  const coords = view.coordinates === true;
  const displayed = groupedRows(view, rows, schema);
  const totals = view.totals ?? {};
  const showTotals = Object.keys(totals).length > 0;

  // The visible width, from the scroller's own adjustment: its page size is
  // what's on screen, and it changes as the window or sidebar does.
  const [containerWidth, setContainerWidth] = useState(0);
  // Rows go above or below another only in a sheet (D41), and not when a sort places them.
  const canInsert = !!onInsertRow && isSheet(view) && canInsertAt(view);
  const hasMenu = !!onOpenBody || !!onDeleteRow || canInsert;
  // The row menu's button sits after the last column: its room comes out
  // of the columns' share, so it stays on screen.
  const chrome = TABLE_CHROME + (coords ? ROW_NUMBER_WIDTH : 0) + (hasMenu ? ROW_MENU_WIDTH : 0);
  const colWidth = columnWidths(fields, { ...(view.columnWidths ?? {}), ...liveWidths }, containerWidth, chrome);

  // A column's handle is on its end edge (the left, right to left, where
  // dragging leftwards widens it); a row's grip is on its bottom edge.
  const columnHandle = (name: string) =>
    onUpdateView ? (
      <GtkBox
        name={`resize-column-${name}`}
        widthRequest={6}
        halign={Gtk.Align.END}
        cursor={Gdk.Cursor.newFromName("col-resize", null)}
        controllers={
          <GtkGestureDrag
            onDragBegin={() => {
              resizeFrom.current = colWidth(name);
            }}
            onDragUpdate={(dx) => setLiveWidths((live) => ({ ...live, [name]: resizedColumnWidth(resizeFrom.current, rtl ? -dx : dx) }))}
            onDragEnd={(dx) => {
              onUpdateView({ columnWidths: { ...(view.columnWidths ?? {}), [name]: resizedColumnWidth(resizeFrom.current, rtl ? -dx : dx) } });
              setLiveWidths({});
            }}
          />
        }
      />
    ) : null;
  const numberOf = (row: Row, index: number): number => rowNumber(sheet?.position, row.id, index);

  const gutter = (content: string, height: number) =>
    coords ? (
      <GtkLabel label={content} widthRequest={ROW_NUMBER_WIDTH} heightRequest={height} cssClasses={[styles.rowNumber]} />
    ) : null;

  const display = useDisplaySettings();
  const { formulaSyntax } = display;

  // A row's grip: only on the row with the selected cell (so nothing else
  // can be dragged by a scroll), at its bottom edge under the start of that
  // cell, so it is in view wherever the table has been scrolled. Dragging
  // resizes that row in whole lines; a double click fits it to what it holds.
  const rowGrip = (row: Row) => {
    const [selectedRow, selectedName] = focusedCell?.split("\u0000") ?? [];
    if (!onUpdateView || (selectedRow !== row.id && liveRow?.rowId !== row.id)) return null;
    const gripName = (selectedRow === row.id ? selectedName : liveRow?.name) ?? fields[0]!;
    let cellStart = coords ? ROW_NUMBER_WIDTH : 0;
    for (const field of fields) {
      if (field === gripName) break;
      cellStart += colWidth(field);
    }
    const saveHeight = (h: number) => onUpdateView({ rowHeights: { ...(view.rowHeights ?? {}), [row.id]: h } });
    return (
      <GtkBox name="resize-row" halign={Gtk.Align.START} valign={Gtk.Align.END} marginStart={cellStart + 4} marginBottom={2} spacing={6}>
        <GtkBox
          name="resize-row-grip"
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          widthRequest={28}
          heightRequest={14}
          cssClasses={[styles.rowGrip]}
          tooltipText="Drag to resize the row; double-click to fit it"
          cursor={Gdk.Cursor.newFromName("row-resize", null)}
          controllers={[
            <GtkGestureDrag
              key="drag"
              onDragBegin={() => {
                resizeFrom.current = heightOf(row.id);
              }}
              onDragUpdate={(_dx, dy) => setLiveRow({ rowId: row.id, h: snappedRowHeight(resizeFrom.current, dy), name: gripName })}
              onDragEnd={(_dx, dy) => {
                saveHeight(snappedRowHeight(resizeFrom.current, dy));
                setLiveRow(null);
              }}
            />,
            <GtkGestureClick
              key="fit"
              onPressed={(nPress) => {
                if (nPress !== 2) return;
                saveHeight(
                  fittedRowHeight(
                    fields.map((name) => ({
                      show: describeCell(fieldMap.get(name), row[name], display, relatedTables),
                      width: colWidth(name),
                    })),
                  ),
                );
              }}
            />,
          ]}
        >
          <GtkImage iconName="list-drag-handle-symbolic" pixelSize={12} hexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} />
        </GtkBox>
        {liveRow?.rowId === row.id ? (
          <GtkLabel
            label={`${linesFor(liveRow.h)} ${linesFor(liveRow.h) === 1 ? "line" : "lines"}`}
            cssClasses={[styles.rowGripLabel]}
          />
        ) : null}
      </GtkBox>
    );
  };

  const header = (
    <GtkBox cssClasses={[styles.headerRow]}>
      {gutter("", HEADER_HEIGHT)}
      {fields.map((name, i) => {
        const field: Field | undefined = fieldMap.get(name);
        const title = field?.title ?? name;
        return (
          <GtkOverlay key={name} overlays={columnHandle(name)}>
          <Cell width={colWidth(name)} height={HEADER_HEIGHT}>
            <GtkLabel
              label={coords ? `${columnLetter(i)}  ${title}` : title}
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
          </GtkOverlay>
        );
      })}
      {onAddField ? (
        <GtkButton
          iconName="list-add-symbolic"
          cssClasses={["flat", "circular"]}
          valign={Gtk.Align.CENTER}
          marginStart={4}
          tooltipText="Add Field"
          onClicked={() => setAddingField(true)}
        />
      ) : null}
    </GtkBox>
  );

  const editable = !!onUpdateRow;

  // The keyboard in the grid: the focused cell is the one it's on, and
  // what each key does is table-ui/shared's gridKey, as the web's is.
  const cells = useRef(new Map<string, Gtk.Box>());
  const [focusedCell, setFocusedCell] = useState<string | null>(null);
  const [editRequest, setEditRequest] = useState<{ key: string; n: number; text?: string } | null>(null);
  const cellKey = (rowId: string, name: string) => `${rowId}\u0000${name}`;
  const rowIds = displayed.map((d) => d.row.id);
  const focusCell = (at: GridPlace) => {
    const rowId = rowIds[at.row];
    const name = fields[at.col];
    if (rowId !== undefined && name !== undefined) cells.current.get(cellKey(rowId, name))?.grabFocus();
  };
  const placeOf = (key: string): GridPlace | null => {
    const [rowId, name] = key.split("\u0000") as [string, string];
    const row = rowIds.indexOf(rowId);
    const col = fields.indexOf(name);
    return row < 0 || col < 0 ? null : { row, col };
  };
  const onGridKey = (keyval: number, state: number): boolean => {
    // Only a cell itself: typing in an editor, or on a button in a cell, is theirs.
    const focus = (cells.current.values().next().value?.getRoot() as Gtk.Window | undefined)?.getFocus();
    const key = [...cells.current].find(([, widget]) => widget === focus)?.[0];
    const k = gridKeyOf(keyval, state);
    if (!key || !k) return false;
    const at = placeOf(key);
    if (!at) return false;
    const rowId = rowIds[at.row]!;
    const name = fields[at.col]!;
    const field = fieldMap.get(name);
    const row = rows.find((r) => r.id === rowId);
    const action = gridKey(at, rowIds.length, fields.length, k, {
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
  const grid = viewGrid(view, fields, displayed.map((d) => d.row.id), sheet);
  const openField = openFormula ? fieldMap.get(openFormula.name) : undefined;
  // While a formula is open: its column tinted, the cells it read outlined.
  const inputCells = openFormula ? formulaInputCells(openField, openFormula.rowId, view, fields, sheet?.order) : new Set<string>();

  const body = displayed.map(({ row, starts }, index) => {
    const rowHeight = heightOf(row.id);
    const lines = linesFor(rowHeight);
    return (
    <GtkBox key={row.id} orientation={Gtk.Orientation.VERTICAL}>
      {starts ? (
        <GtkLabel
          label={`${starts.label}  ·  ${starts.count}`}
          xalign={0}
          cssClasses={[styles.groupRow]}
        />
      ) : null}
      <GtkOverlay overlays={rowGrip(row)}>
      <BodyRow
        rowId={row.id}
        menu={hasMenu}
        hasBody={bodies?.[row.id] !== undefined}
        canInsert={canInsert}
        onOpenBody={onOpenBody}
        onDeleteRow={onDeleteRow}
        onInsertRow={onInsertRow}
      >
        {gutter(String(numberOf(row, index)), rowHeight)}
        {fields.map((name, i) => {
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
              onFocused={(focused) => setFocusedCell((was) => (focused ? cellKey(row.id, name) : was === cellKey(row.id, name) ? null : was))}
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
                      if (at) focusCell(afterEdit(at, how, rowIds.length, fields.length));
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
                    iconName="document-open-symbolic"
                    cssClasses={["flat", "circular"]}
                    valign={Gtk.Align.CENTER}
                    tooltipText="Open the row's page"
                    onClicked={() => onOpenBody(row.id)}
                  />
                ) : null}
              </GtkBox>
            </Cell>
          );
        })}
      </BodyRow>
      </GtkOverlay>
    </GtkBox>
    );
  });

  const addRow = onAddRow ? (
    <GtkButton
      halign={Gtk.Align.START}
      cssClasses={["flat"]}
      marginStart={coords ? ROW_NUMBER_WIDTH : 0}
      onClicked={() => {
        const id = onAddRow();
        if (typeof id === "string") setJustAdded(id);
      }}
    >
      <GtkBox spacing={6}>
        <GtkImage iconName="list-add-symbolic" />
        <GtkLabel label="New Row" />
      </GtkBox>
    </GtkButton>
  ) : null;

  const footer = showTotals ? (
    <GtkBox cssClasses={[styles.totalsRow]}>
      {gutter("", HEADER_HEIGHT)}
      {fields.map((name) => {
        const kind = totals[name];
        const field = fieldMap.get(name);
        const total = kind ? totalFor(rows, name, kind) : undefined;
        return (
          <Cell key={name} width={colWidth(name)} height={HEADER_HEIGHT}>
            {kind && total ? (
              <GtkBox hexpand>
                <GtkLabel label={TOTAL_LABELS[kind]} cssClasses={[styles.totalLabel]} />
                {total.numeric ? (
                  <CellValue field={field} value={total.value} relatedTables={relatedTables} lines={1} xalign={1} />
                ) : (
                  <GtkLabel label={String(total.value ?? "")} cssClasses={[styles.tabular]} />
                )}
              </GtkBox>
            ) : (
              <GtkLabel label="" />
            )}
          </Cell>
        );
      })}
    </GtkBox>
  ) : null;

  return (
    <GtkScrolledWindow
      hexpand
      vexpand
      cssClasses={[styles.table]}
      hadjustment={<GtkAdjustment onNotifyPageSize={(size) => setContainerWidth(Math.floor(size ?? 0))} />}
    >
      <GtkBox
        orientation={Gtk.Orientation.VERTICAL}
        halign={Gtk.Align.START}
        valign={Gtk.Align.START}
        controllers={<GtkEventControllerKey onKeyPressed={(keyval, _code, state) => onGridKey(keyval, state)} />}
      >
        {header}
        {body}
        {addRow}
        {footer}
      </GtkBox>
      {openFormula && openField ? (() => {
        const openRow = rows.find((r) => r.id === openFormula.rowId);
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
          onAdd={onAddField}
          onClose={() => setAddingField(false)}
        />
      ) : null}
    </GtkScrolledWindow>
  );
}
