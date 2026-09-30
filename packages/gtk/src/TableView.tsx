// The table layout on GTK: a header of field titles, a row per record at
// the view's row height, group headings when the view groups, and the
// totals footer. Columns are sized by the same rule as the web grid
// (`columnWidths`), so a view saved on one looks the same on the other.
//
// Plain boxes rather than GtkColumnView, as the web grid is plain elements:
// every row is built. Large tables (docs/LARGE-TABLES.md) will want the
// recycling list instead; the cells stay as they are when that comes.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { GMenu, GSimpleAction, GSimpleActionGroup } from "@gtkx/jsx/gio";
import {
  GtkAdjustment,
  GtkBox,
  GtkButton,
  GtkGestureClick,
  GtkImage,
  GtkLabel,
  GtkMenuButton,
  GtkPopoverMenu,
  GtkScrolledWindow,
} from "@gtkx/jsx/gtk";
import type { MenuItem } from "@gtkx/react/internal";
import { columnLetter, effectiveAlign, type Field, type FieldAlignment, type Row } from "@workspace.sh/table-core";
import {
  canInsertAt,
  DEFAULT_ROW_HEIGHT,
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
} from "@workspace.sh/table-ui/shared";
import { useRef, useState, type ReactNode } from "react";
import { CellValue } from "./CellValue.js";
import { EditableCell } from "./EditableCell.js";
import { AddField, FieldEditor } from "./FieldEditor.js";
import { FormulaPanel } from "./FormulaPanel.js";
import { styles } from "./theme.js";

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
function Cell({ width, height, children, classes = [] }: { width: number; height: number; children: ReactNode; classes?: string[] }) {
  return (
    <GtkBox widthRequest={width} heightRequest={height} hexpand={false} cssClasses={[styles.cell, styles.columnRule, ...classes]}>
      {children}
    </GtkBox>
  );
}

/** The row menu's entries, by what the table was given to do. */
function rowMenu(hasBody: boolean, canOpen: boolean, canInsert: boolean, canDelete: boolean): MenuItem[] {
  return [
    // A row without a page can have one started from here.
    ...(canOpen ? [{ section: [{ label: hasBody ? "Open Page" : "Add Page", action: "row.open" }] }] : []),
    ...(canInsert
      ? [{ section: [{ label: "Insert Row Above", action: "row.above" }, { label: "Insert Row Below", action: "row.below" }] }]
      : []),
    ...(canDelete ? [{ section: [{ label: "Delete Row…", action: "row.delete" }] }] : []),
  ];
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
            menuModel={<GMenu items={rowMenu(hasBody, !!onOpenBody, canInsert, !!onDeleteRow)} />}
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
  const rowHeight = view.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const lines = linesFor(rowHeight);
  const coords = view.coordinates === true;
  const displayed = groupedRows(view, rows, schema);
  const totals = view.totals ?? {};
  const showTotals = Object.keys(totals).length > 0;

  // The visible width, from the scroller's own adjustment: its page size is
  // what's on screen, and it changes as the window or sidebar does.
  const [containerWidth, setContainerWidth] = useState(0);
  const canInsert = !!onInsertRow && canInsertAt(view);
  const hasMenu = !!onOpenBody || !!onDeleteRow || canInsert;
  // The row menu's button sits after the last column: its room comes out
  // of the columns' share, so it stays on screen.
  const chrome = TABLE_CHROME + (coords ? ROW_NUMBER_WIDTH : 0) + (hasMenu ? ROW_MENU_WIDTH : 0);
  const colWidth = columnWidths(fields, view.columnWidths ?? {}, containerWidth, chrome);

  const rowNumber = (row: Row, index: number): number => sheet?.position.get(row.id) ?? index + 1;

  const gutter = (content: string, height: number) =>
    coords ? (
      <GtkLabel label={content} widthRequest={ROW_NUMBER_WIDTH} heightRequest={height} cssClasses={[styles.rowNumber]} />
    ) : null;

  const header = (
    <GtkBox cssClasses={[styles.headerRow]}>
      {gutter("", HEADER_HEIGHT)}
      {fields.map((name, i) => {
        const field: Field | undefined = fieldMap.get(name);
        const title = field?.title ?? name;
        return (
          <Cell key={name} width={colWidth(name)} height={HEADER_HEIGHT}>
            <GtkLabel
              label={coords ? `${columnLetter(i)}  ${title}` : title}
              xalign={xalignOf(effectiveAlign(field))}
              hexpand
              ellipsize={Pango.EllipsizeMode.END}
              maxWidthChars={1}
              cssClasses={[styles.headerCell]}
              tooltipText={schemaEditable ? `${field?.description ?? title} · Edit Field` : (field?.description ?? title)}
              // A header opens its field's editor, where the schema can be edited.
              controllers={schemaEditable ? <GtkGestureClick onReleased={() => setEditingField(name)} /> : undefined}
            />
          </Cell>
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
  // Typed and shown against the grid as saved, so =C3 means the same row
  // whatever this reader's sort or search (D41).
  const grid = viewGrid(view, fields, displayed.map((d) => d.row.id), sheet);
  const openField = openFormula ? fieldMap.get(openFormula.name) : undefined;
  // While a formula is open: its column tinted, the cells it read outlined.
  const inputCells = openFormula ? formulaInputCells(openField, openFormula.rowId, view, fields, sheet?.order) : new Set<string>();

  const body = displayed.map(({ row, starts }, index) => (
    <GtkBox key={row.id} orientation={Gtk.Orientation.VERTICAL}>
      {starts ? (
        <GtkLabel
          label={`${starts.label}  ·  ${starts.count}`}
          xalign={0}
          cssClasses={[styles.groupRow]}
        />
      ) : null}
      <BodyRow
        rowId={row.id}
        menu={hasMenu}
        hasBody={bodies?.[row.id] !== undefined}
        canInsert={canInsert}
        onOpenBody={onOpenBody}
        onDeleteRow={onDeleteRow}
        onInsertRow={onInsertRow}
      >
        {gutter(String(rowNumber(row, index)), rowHeight)}
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
              ]}
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
    </GtkBox>
  ));

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
      <GtkBox orientation={Gtk.Orientation.VERTICAL} halign={Gtk.Align.START} valign={Gtk.Align.START}>
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
