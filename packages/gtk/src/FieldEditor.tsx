// A field's editor and "add a field", on GTK, as libadwaita preference
// dialogs. What they offer and what each change sets come from
// table-ui/shared's fieldEdit (formats, choices, required, formulas, new
// fields' keys), as the web field editor's do.

import type * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import {
  AdwActionRow,
  AdwComboRow,
  AdwDialog,
  AdwEntryRow,
  AdwHeaderBar,
  AdwPreferencesGroup,
  AdwPreferencesPage,
  AdwSwitchRow,
  AdwToolbarView,
} from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkEntry, GtkLabel } from "@gtkx/jsx/gtk";
import { defaultAlignFor, enumOptions, type CompileResult, type Field, type Grid } from "@workspace.sh/table-core";
import {
  addableChoices,
  ALIGN_CHOICES,
  alignLabel,
  alignPatch,
  currencyCodes,
  currencyName,
  fieldFormula,
  formatState,
  formulaStatus,
  friendlyType,
  newChoice,
  newField,
  requiredPatch,
  takesChoices,
  useDirection,
  useDisplaySettings,
  formulaDraftOf,
  type AddableChoice,
} from "@workspace.sh/table-ui/shared";
import { useState } from "react";
import { StringList } from "./StringList.js";
import { useSelected } from "./useSelected.js";

/** A combo row over values, showing labels; the selection set once its model is in. */
function Combo({
  title,
  options,
  value,
  onChange,
  search,
}: {
  title: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  search?: boolean;
}) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const labels = options.map((o) => o.label);
  const ref = useSelected<Adw.ComboRow>(at, labels.join("\u0000"));
  return (
    <AdwComboRow
      ref={ref}
      title={title}
      enableSearch={search}
      model={<StringList strings={labels} />}
      selected={at}
      onNotifySelected={(index) => {
        if (index === null || index === at || !options[index]) return;
        onChange(options[index].value);
      }}
    />
  );
}

/** A formula's status line, as the web's: why it won't save, its warnings, or what the file will hold. */
function FormulaLine({ compiled, typed }: { compiled: CompileResult | null; typed: string }) {
  if (!compiled) return null;
  const status = formulaStatus(compiled, typed);
  if (status.kind === "error") return <GtkLabel label={status.message} xalign={0} wrap cssClasses={["error", "caption"]} />;
  return (
    <>
      {status.warnings.map((w) => (
        <GtkLabel key={w} label={w} xalign={0} wrap cssClasses={["warning", "caption"]} />
      ))}
      {status.storedAs !== undefined ? <GtkLabel label={`Stored as ${status.storedAs}`} xalign={0} wrap selectable cssClasses={["dim-label", "caption", "monospace"]} /> : null}
    </>
  );
}

export interface FieldEditorProps {
  field: Field;
  /** Where it is among the fields, so it can't move past either end. */
  fieldIndex: number;
  totalFields: number;
  /** The table's fields: formulas are checked against them, and formats inherit from them. */
  fields: Field[];
  onUpdate: (patch: Partial<Field>) => void;
  onAddChoice: (value: string) => void;
  onMove: (delta: -1 | 1) => void;
  onClose: () => void;
  /** The sheet, when the view shows coordinates: `=B7` can be typed and is shown (D34). */
  grid?: Grid;
}

export function FieldEditor({ field, fieldIndex, totalFields, fields, onUpdate, onAddChoice, onMove, onClose, grid }: FieldEditorProps) {
  const display = useDisplaySettings();
  const rtl = useDirection() === "rtl";
  const [choiceDraft, setChoiceDraft] = useState("");
  const [formulaDraft, setFormulaDraft] = useState(() => (field.computed ? formulaDraftOf(field, grid, display.formulaSyntax) : ""));
  const formula = field.computed ? fieldFormula(field, fields, formulaDraft, grid) : null;
  const format = formatState(field, fields, display);
  const auto = alignLabel(defaultAlignFor(field.type), rtl).toLowerCase();

  return (
    <AdwDialog title={field.title ?? field.name} contentWidth={520} contentHeight={640} onClosed={onClose}>
      <AdwToolbarView topBar={<AdwHeaderBar />}>
        <AdwPreferencesPage>
          <AdwPreferencesGroup description={`${field.computed ? "Formula" : friendlyType(field.type)} · stored as “${field.name}”`}>
            <AdwEntryRow title="Title" text={field.title ?? ""} showApplyButton onApply={(row) => onUpdate({ title: row.getText() || undefined })} />
            <AdwEntryRow title="Description" text={field.description ?? ""} showApplyButton onApply={(row) => onUpdate({ description: row.getText() || undefined })} />
          </AdwPreferencesGroup>

          {formula ? (
            <AdwPreferencesGroup title="Formula" description="One formula for the whole column.">
              <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                <GtkEntry
                  text={formulaDraft}
                  cssClasses={["monospace", ...(formula.compiled.ok ? [] : ["error"])]}
                  onChanged={(e) => setFormulaDraft(e.getText())}
                  onActivate={() => formula.save && onUpdate(formula.save)}
                />
                <FormulaLine compiled={formula.compiled} typed={formulaDraft} />
                <GtkButton
                  label="Save Formula"
                  halign={Gtk.Align.END}
                  cssClasses={["suggested-action"]}
                  sensitive={formula.save !== undefined}
                  onClicked={() => formula.save && onUpdate(formula.save)}
                />
              </GtkBox>
            </AdwPreferencesGroup>
          ) : null}

          <AdwPreferencesGroup title="Display">
            {format ? <Combo title="Format" options={format.choices} value={format.kind} onChange={(v) => onUpdate(format.choose(v))} /> : null}
            {format?.kind === "decimal" ? (
              <Combo
                title="Decimal Places"
                options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: String(d) }))}
                value={String(format.digits)}
                onChange={(v) => onUpdate(format.decimal(Number(v)))}
              />
            ) : null}
            {format?.kind === "currency" ? (
              <Combo
                title="Currency"
                search
                options={currencyCodes().map((c) => ({ value: c, label: `${c} · ${currencyName(c, display.locale)}` }))}
                value={format.code}
                onChange={(v) => onUpdate(format.currency(v))}
              />
            ) : null}
            <Combo
              title="Alignment"
              options={ALIGN_CHOICES.map((a) => ({ value: a, label: a === "auto" ? `Auto (${auto})` : alignLabel(a, rtl) }))}
              value={field.align ?? "auto"}
              onChange={(v) => onUpdate(alignPatch(v as (typeof ALIGN_CHOICES)[number]))}
            />
          </AdwPreferencesGroup>
          {format && format.notes.length > 0 ? (
            <AdwPreferencesGroup>
              {format.notes.map((n) => (
                <GtkLabel key={n.text} label={n.text} xalign={0} wrap cssClasses={[n.kind === "warn" ? "warning" : "dim-label", "caption"]} />
              ))}
            </AdwPreferencesGroup>
          ) : null}

          <AdwPreferencesGroup title="Rules">
            <AdwSwitchRow
              title="Required"
              active={field.constraints?.required === true}
              onNotifyActive={(on) => {
                if (!!on !== (field.constraints?.required === true)) onUpdate(requiredPatch(field, !!on));
              }}
            />
            <AdwSwitchRow
              title="Deprecated"
              subtitle="Hidden from new views; its values stay in the file"
              active={field.deprecated === true}
              onNotifyActive={(on) => {
                if (!!on !== (field.deprecated === true)) onUpdate({ deprecated: on || undefined });
              }}
            />
          </AdwPreferencesGroup>

          {takesChoices(field) ? (
            <AdwPreferencesGroup title="Choices">
              {enumOptions(field).map((o) => (
                <AdwActionRow key={o.value} title={o.label ?? o.value} subtitle={o.label && o.label !== o.value ? o.value : undefined} />
              ))}
              <AdwEntryRow
                title="Add Choice"
                text={choiceDraft}
                showApplyButton
                onChanged={(row) => setChoiceDraft(row.getText())}
                onApply={(row) => {
                  const value = newChoice(field, row.getText());
                  if (value === null) return;
                  onAddChoice(value);
                  setChoiceDraft("");
                  row.setText("");
                }}
              />
            </AdwPreferencesGroup>
          ) : null}

          <AdwPreferencesGroup title="Position">
            <GtkBox spacing={6}>
              <GtkButton label="Move Earlier" sensitive={fieldIndex > 0} onClicked={() => onMove(-1)} />
              <GtkButton label="Move Later" sensitive={fieldIndex < totalFields - 1} onClicked={() => onMove(1)} />
            </GtkBox>
          </AdwPreferencesGroup>
        </AdwPreferencesPage>
      </AdwToolbarView>
    </AdwDialog>
  );
}

export interface AddFieldProps {
  /** Every field's key, so the new one's never clashes. */
  existing: Set<string>;
  fields: Field[];
  onAdd: (field: Field) => void;
  onClose: () => void;
  grid?: Grid;
}

/** "Add a field": a name, a type, and a formula when it's a formula. */
export function AddField({ existing, fields, onAdd, onClose, grid }: AddFieldProps) {
  const { formulaSyntax } = useDisplaySettings();
  const [name, setName] = useState("");
  const [type, setType] = useState<AddableChoice>("string");
  const [formulaDraft, setFormulaDraft] = useState("");
  const made = newField({ name, type, formula: formulaDraft, existing, fields, grid });
  const add = () => {
    if (!made.field) return;
    onAdd(made.field);
    onClose();
  };
  const trimmed = name.trim();

  return (
    <AdwDialog title="Add Field" contentWidth={440} onClosed={onClose}>
      <AdwToolbarView
        topBar={<AdwHeaderBar />}
        bottomBar={
          <GtkBox marginStart={12} marginEnd={12} marginTop={6} marginBottom={12} halign={Gtk.Align.END}>
            <GtkButton label="Add Field" cssClasses={["suggested-action"]} sensitive={made.field !== null} onClicked={add} />
          </GtkBox>
        }
      >
        <AdwPreferencesPage>
          <AdwPreferencesGroup description={trimmed && made.key !== trimmed ? `Stored as “${made.key}”` : undefined}>
            <AdwEntryRow title="Name" text={name} onChanged={(row) => setName(row.getText())} onEntryActivated={add} />
            <Combo title="Type" options={addableChoices()} value={type} onChange={(v) => setType(v as AddableChoice)} />
          </AdwPreferencesGroup>
          {type === "formula" ? (
            <AdwPreferencesGroup title="Formula">
              <GtkBox orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                <GtkEntry
                  text={formulaDraft}
                  placeholderText={formulaSyntax === "stored" ? "(round (/ budget 12) 0)" : "=round(budget / 12, 0)"}
                  cssClasses={["monospace", ...(made.compiled && !made.compiled.ok ? ["error"] : [])]}
                  onChanged={(e) => setFormulaDraft(e.getText())}
                  onActivate={add}
                />
                <FormulaLine compiled={made.compiled} typed={formulaDraft} />
              </GtkBox>
            </AdwPreferencesGroup>
          ) : null}
        </AdwPreferencesPage>
      </AdwToolbarView>
    </AdwDialog>
  );
}
