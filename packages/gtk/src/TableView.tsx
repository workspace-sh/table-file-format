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
import { GtkAdjustment, GtkBox, GtkButton, GtkLabel, GtkScrolledWindow } from "@gtkx/jsx/gtk";
import { columnLetter, effectiveAlign, type Field, type FieldAlignment, type Row } from "@workspace.sh/table-core";
import {
  DEFAULT_ROW_HEIGHT,
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
import { useState, type ReactNode } from "react";
import { CellValue } from "./CellValue.js";
import { styles } from "./theme.js";

/** The web grid's rule for the chrome: its two outer borders. */
const TABLE_CHROME = 2;
const HEADER_HEIGHT = 36;

function xalignOf(align: FieldAlignment): number {
  return align === "center" ? 0.5 : align === "end" ? 1 : 0;
}

/**
 * One cell, exactly `width` wide whatever it holds.
 *
 * `widthRequest` keeps a short value from narrowing the column, and
 * nothing in a cell asks for more: text ellipsizes (its natural width is a
 * character), and a row of pills clips (see `Clipped`). Every row's cells
 * then line up under the header with no grid to align them.
 */
function Cell({ width, height, children, classes = [] }: { width: number; height: number; children: ReactNode; classes?: string[] }) {
  return (
    <GtkBox widthRequest={width} heightRequest={height} cssClasses={[styles.cell, styles.columnRule, ...classes]}>
      {children}
    </GtkBox>
  );
}

export function TableView({
  view,
  rows,
  schema,
  bodies,
  relatedTables,
  onOpenBody,
  onOpenRelation,
  sheet,
}: ViewProps) {
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
  const chrome = TABLE_CHROME + (coords ? ROW_NUMBER_WIDTH : 0);
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
              tooltipText={field?.description ?? title}
            />
          </Cell>
        );
      })}
    </GtkBox>
  );

  const body = displayed.map(({ row, starts }, index) => (
    <GtkBox key={row.id} orientation={Gtk.Orientation.VERTICAL}>
      {starts ? (
        <GtkLabel
          label={`${starts.label}  ·  ${starts.count}`}
          xalign={0}
          cssClasses={[styles.groupRow]}
        />
      ) : null}
      <GtkBox cssClasses={[styles.bodyRow]}>
        {gutter(String(rowNumber(row, index)), rowHeight)}
        {fields.map((name, i) => {
          const field = fieldMap.get(name);
          return (
            <Cell key={name} width={colWidth(name)} height={rowHeight}>
              <GtkBox spacing={6} valign={lines > 1 ? Gtk.Align.START : Gtk.Align.CENTER} marginTop={lines > 1 ? 10 : 0}>
                <CellValue
                  field={field}
                  value={row[name]}
                  relatedTables={relatedTables}
                  onOpenRelation={onOpenRelation}
                  lines={lines}
                  xalign={xalignOf(effectiveAlign(field))}
                />
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
      </GtkBox>
    </GtkBox>
  ));

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
        {footer}
      </GtkBox>
    </GtkScrolledWindow>
  );
}
