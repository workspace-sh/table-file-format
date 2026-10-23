// A formula cell opened to see how it was worked out, on GTK: an AdwDialog
// with the column's one formula, what it read, and what a changed formula
// would make here. What it says comes from table-ui's shared
// `explainFormula`, as the web panel's does (D29, D34, D41).

import * as Gtk from "@gtkx/gi/gtk";
import { AdwDialog, AdwHeaderBar, AdwPreferencesGroup, AdwSwitchRow, AdwToolbarView } from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkLabel } from "@gtkx/jsx/gtk";
import { printFormula, type ComputeOptions, type Field, type Grid, type ParsedTable, type Row } from "@workspace.sh/table-core";
import { explainFormula, formulaDraftOf, useDisplaySettings } from "@workspace.sh/table-ui/shared";
import { useState } from "react";
import { CellValue } from "./CellValue.js";
import { columnsFor, FormulaEntry } from "./FormulaEntry.js";

export interface FormulaPanelProps {
  field: Field;
  /** The row as displayed, computed values filled in. */
  row: Record<string, unknown>;
  fields: Field[];
  relatedTables?: Record<string, ParsedTable>;
  /** Save a new formula for the column. Absent: read-only. */
  onSave?: (patch: Partial<Field>) => void;
  onClose: () => void;
  /** The sheet, with this row as `here`, when the view shows coordinates. */
  grid?: Grid;
  allRows?: Row[];
  computeOptions?: ComputeOptions;
  /** This cell's own formula, when it has one: its row's exception to the column's (D52). */
  own?: string;
  /** Save a formula for this row only, or (null) take this row's back to the column's. Absent: the column's only. */
  onSaveRow?: (expr: string | null) => void;
}

/** One line: what it's called, then its value as its cell shows it. */
function ValueLine({ label, field, value, relatedTables, emphasis }: { label: string; field: Field | undefined; value: unknown; relatedTables?: Record<string, ParsedTable>; emphasis?: boolean }) {
  return (
    <GtkBox spacing={12}>
      <GtkLabel label={label} xalign={0} widthRequest={140} cssClasses={emphasis ? ["heading"] : ["dim-label"]} />
      <GtkBox hexpand>
        <CellValue field={field} value={value} relatedTables={relatedTables} lines={1} />
      </GtkBox>
    </GtkBox>
  );
}

export function FormulaPanel({ field, row, fields, relatedTables, onSave, onClose, grid, allRows, computeOptions, own, onSaveRow }: FormulaPanelProps) {
  const { formulaSyntax } = useDisplaySettings();
  // Edited here, from any cell: the column's formula, saved for every row,
  // or (D52) this row's own, which a row that has one opens on.
  const [rowOnly, setRowOnly] = useState(own !== undefined);
  const [draft, setDraft] = useState(() => (own !== undefined ? printFormula(own, { grid, syntax: formulaSyntax }) : formulaDraftOf(field, grid, formulaSyntax)));
  const explained = explainFormula({ field, row, fields, draft, editable: !!onSave, grid, allRows, computeOptions, rowOnly, ...(own !== undefined ? { own } : {}) });
  const byName = new Map(fields.map((f) => [f.name, f]));
  const status = explained.status;
  const canSave = rowOnly ? !!onSaveRow && explained.saveRow !== undefined : !!onSave && !!explained.save;
  const save = () => {
    if (!canSave) return;
    if (rowOnly) onSaveRow!(explained.saveRow!);
    else onSave!(explained.save!);
    onClose();
  };

  return (
    <AdwDialog title={field.title ?? field.name} contentWidth={460} onClosed={onClose}>
      <AdwToolbarView
        topBar={<AdwHeaderBar />}
        bottomBar={
          <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12} halign={Gtk.Align.END}>
            {own !== undefined && onSaveRow ? (
              <GtkButton
                label="Use the Column's Formula"
                onClicked={() => {
                  onSaveRow(null);
                  onClose();
                }}
              />
            ) : null}
            {onSave ? (
              <GtkButton label={rowOnly ? "Save for This Row" : "Save for Every Row"} cssClasses={["suggested-action"]} sensitive={canSave} onClicked={save} />
            ) : null}
          </GtkBox>
        }
      >
        <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={18} marginStart={18} marginEnd={18} marginTop={6} marginBottom={6}>
          <AdwPreferencesGroup
            title="Formula"
            description={
              rowOnly
                ? "A formula for this row only. Every other row is worked out by the column's."
                : own !== undefined
                  ? "This row has a formula of its own; the column's is shown. Saving it for every row leaves this row's as it is."
                  : "One formula for the whole column. Every row is worked out the same way."
            }
          >
            {onSave ? (
              <FormulaEntry text={draft} onChange={setDraft} onActivate={save} error={status?.kind === "error"} columns={columnsFor(fields, grid, field.name)}>
                {status?.kind === "error" ? (
                  <GtkLabel label={status.message} xalign={0} wrap cssClasses={["error", "caption"]} />
                ) : status ? (
                  <>
                    {status.warnings.map((w) => (
                      <GtkLabel key={w} label={w} xalign={0} wrap cssClasses={["warning", "caption"]} />
                    ))}
                    {status.storedAs !== undefined ? (
                      <GtkLabel label={`Stored as ${status.storedAs}`} xalign={0} wrap selectable cssClasses={["dim-label", "caption", "monospace"]} />
                    ) : null}
                  </>
                ) : null}
              </FormulaEntry>
            ) : (
              <GtkLabel label={draft} xalign={0} wrap selectable cssClasses={["monospace"]} />
            )}
          </AdwPreferencesGroup>

          {onSave && onSaveRow ? (
            <AdwPreferencesGroup>
              <AdwSwitchRow
                title="This Row Only"
                active={rowOnly}
                onNotifyActive={(on) => {
                  if (!!on !== rowOnly) setRowOnly(!!on);
                }}
              />
            </AdwPreferencesGroup>
          ) : null}

          {explained.thisRow.length > 0 ? (
            <AdwPreferencesGroup title="In This Row">
              <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6}>
                {explained.thisRow.map((input) => (
                  <ValueLine key={input.field} label={input.label} field={byName.get(input.field)} value={input.value} relatedTables={relatedTables} />
                ))}
              </GtkBox>
            </AdwPreferencesGroup>
          ) : null}

          {explained.otherRows.length > 0 ? (
            <AdwPreferencesGroup title="From Other Rows">
              <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6}>
                {explained.otherRows.map((input) => (
                  <ValueLine
                    key={`${input.rowId}\u0000${input.field}`}
                    label={input.label}
                    field={byName.get(input.field)}
                    value={input.value}
                    relatedTables={relatedTables}
                  />
                ))}
              </GtkBox>
            </AdwPreferencesGroup>
          ) : null}

          <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            <ValueLine label="Result" field={field} value={row[field.name]} relatedTables={relatedTables} emphasis />
            {explained.preview ? (
              <ValueLine label="With This Formula" field={field} value={explained.preview.value} relatedTables={relatedTables} emphasis />
            ) : null}
          </GtkBox>
        </GtkBox>
      </AdwToolbarView>
    </AdwDialog>
  );
}
