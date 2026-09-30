// A view's settings on GTK, as a libadwaita preferences dialog: its name
// and layout, the field a board, calendar or gallery is drawn from, whether
// a table is a sheet, its grouping, filters and sorts (SPEC section 4).
// The rules (which layouts a table can use, what a new filter starts as,
// that a sort drops a dragged order) are table-ui/shared's viewEdit, as
// the web panel's are; the props are the same `ViewSettingsProps`.

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
import { GtkBox, GtkButton, GtkDropDown, GtkEntry } from "@gtkx/jsx/gtk";
import { enumOptions, type Field, type FilterOperator, type ViewFilter, type ViewLayout, type ViewSort } from "@workspace.sh/table-core";
import {
  OPERATOR_LABELS,
  filterOnField,
  filtersPatch,
  filterValueFrom,
  filterValueText,
  filterWithOperator,
  layoutOptions,
  layoutPatch,
  newFilter,
  newSort,
  operatorsFor,
  picksChoice,
  sortsPatch,
  takesValue,
  viewFieldChoices,
  type ViewSettingsProps,
  sheetPatch,
  orderNote,
} from "@workspace.sh/table-ui/shared";
import { StringList } from "./StringList.js";
import { useSelected } from "./useSelected.js";
import { useState } from "react";

const label = (f: Field) => f.title ?? f.name;

/**
 * A combo row over string values. A combo row can't disable an entry, so
 * only what can be chosen is offered; `none` adds an empty first choice.
 */
function Choice({
  title,
  subtitle,
  options,
  value,
  none,
  onChange,
}: {
  title: string;
  subtitle?: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  none?: string;
  onChange: (value: string | undefined) => void;
}) {
  const all = none !== undefined ? [{ value: "", label: none }, ...options] : options;
  const at = Math.max(0, all.findIndex((o) => o.value === (value ?? "")));
  const ref = useSelected<Adw.ComboRow>(at, all.map((o) => o.label).join("\u0000"));
  return (
    <AdwComboRow
      ref={ref}
      title={title}
      subtitle={subtitle}
      model={<StringList strings={all.map((o) => o.label)} />}
      selected={at}
      onNotifySelected={(index) => {
        if (index === null || index === at || !all[index]) return;
        onChange(all[index].value || undefined);
      }}
    />
  );
}

/** A small drop-down, for a filter's or sort's parts in one row. */
function Pick({ options, value, onChange, tooltip }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; tooltip: string }) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const ref = useSelected<Gtk.DropDown>(at, options.map((o) => o.label).join("\u0000"));
  return (
    <GtkDropDown
      ref={ref}
      tooltipText={tooltip}
      valign={Gtk.Align.CENTER}
      selected={at}
      model={<StringList strings={options.map((o) => o.label)} />}
      onNotifySelected={(index) => {
        if (index === null || index === at || !options[index]) return;
        onChange(options[index].value);
      }}
    />
  );
}

function FilterRow({ filter, fields, onChange, onRemove }: { filter: ViewFilter; fields: Field[]; onChange: (next: ViewFilter) => void; onRemove: () => void }) {
  const field = fields.find((f) => f.name === filter.field);
  // What's typed, kept as typed, so "1," on the way to "1, 2" isn't
  // tidied away under the cursor. The stored value follows it.
  const [draft, setDraft] = useState(() => filterValueText(filter.value));
  const choices = enumOptions(field);
  return (
    <AdwActionRow title="Where" activatable={false}>
      <GtkBox spacing={6} valign={Gtk.Align.CENTER}>
        <Pick
          tooltip="Field"
          options={fields.map((f) => ({ value: f.name, label: label(f) }))}
          value={filter.field}
          onChange={(name) => {
            const next = fields.find((f) => f.name === name);
            if (!next) return;
            setDraft("");
            onChange(filterOnField(filter, next));
          }}
        />
        <Pick
          tooltip="Condition"
          options={operatorsFor(field).map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
          value={filter.operator}
          onChange={(op) => onChange(filterWithOperator(filter, field, op as FilterOperator, draft))}
        />
        {takesValue(filter.operator) ? (
          picksChoice(field, filter.operator) ? (
            <Pick
              tooltip="Value"
              options={[{ value: "", label: "Choose…" }, ...choices.map((c) => ({ value: c.value, label: c.label ?? c.value }))]}
              value={String(filter.value ?? "")}
              onChange={(v) => onChange({ ...filter, value: v })}
            />
          ) : (
            <GtkEntry
              text={draft}
              widthChars={10}
              valign={Gtk.Align.CENTER}
              placeholderText={filter.operator === "in" || filter.operator === "not_in" ? "a, b, c" : "Value"}
              onChanged={(e) => {
                const text = e.getText();
                if (text === draft) return;
                setDraft(text);
                onChange({ ...filter, value: filterValueFrom(field, filter.operator, text) });
              }}
            />
          )
        ) : null}
        <GtkButton iconName="list-remove-symbolic" cssClasses={["flat", "circular"]} valign={Gtk.Align.CENTER} tooltipText="Remove Filter" onClicked={onRemove} />
      </GtkBox>
    </AdwActionRow>
  );
}

function SortRow({ sort, fields, onChange, onRemove }: { sort: ViewSort; fields: Field[]; onChange: (next: ViewSort) => void; onRemove: () => void }) {
  return (
    <AdwActionRow title="By" activatable={false}>
      <GtkBox spacing={6} valign={Gtk.Align.CENTER}>
        <Pick tooltip="Field" options={fields.map((f) => ({ value: f.name, label: label(f) }))} value={sort.field} onChange={(name) => onChange({ ...sort, field: name })} />
        <Pick
          tooltip="Direction"
          options={[
            { value: "asc", label: "Ascending" },
            { value: "desc", label: "Descending" },
          ]}
          value={sort.direction}
          onChange={(d) => onChange({ ...sort, direction: d as "asc" | "desc" })}
        />
        <GtkButton iconName="list-remove-symbolic" cssClasses={["flat", "circular"]} valign={Gtk.Align.CENTER} tooltipText="Remove Sort" onClicked={onRemove} />
      </GtkBox>
    </AdwActionRow>
  );
}

export interface GtkViewSettingsProps extends ViewSettingsProps {
  /**
   * Bumped when a change the controls made was refused (a question
   * answered Cancel): a GTK switch or picker keeps what it was set to, so
   * the layout controls are drawn again from the view.
   */
  revision?: number;
}

export function ViewSettings({ view, schema, onChange, onDelete, onClose, onArrange, personal, onSaveForEveryone, onReset, revision = 0 }: GtkViewSettingsProps) {
  const arrange = onArrange ?? onChange;
  const choices = viewFieldChoices(schema);
  const filters = view.filter ?? [];
  const sorts = view.sort ?? [];
  const fieldOptions = (fields: Field[]) => fields.map((f) => ({ value: f.name, label: label(f) }));
  const layouts = layoutOptions(schema).filter((o) => !o.disabled || o.value === view.layout);
  const unavailable = layoutOptions(schema).filter((o) => o.disabled);

  return (
    <AdwDialog title="View Settings" contentWidth={560} contentHeight={640} onClosed={onClose}>
      <AdwToolbarView topBar={<AdwHeaderBar />}>
        <AdwPreferencesPage>
          <AdwPreferencesGroup key={revision}>
            <AdwEntryRow title="Name" text={view.name} showApplyButton onApply={(row) => onChange({ name: row.getText() })} />
            <Choice
              title="Layout"
              subtitle={unavailable.length > 0 ? unavailable.map((o) => o.label).join(", ") : undefined}
              options={layouts}
              value={view.layout}
              onChange={(l) => l && onChange(layoutPatch(view, schema, l as ViewLayout))}
            />
            {view.layout === "board" ? (
              <Choice title="Columns From" options={fieldOptions(choices.board)} value={view.board_field} onChange={(f) => onChange({ board_field: f })} />
            ) : null}
            {view.layout === "calendar" ? (
              <Choice title="Dates From" options={fieldOptions(choices.date)} value={view.calendar_field} onChange={(f) => onChange({ calendar_field: f })} />
            ) : null}
            {view.layout === "gallery" ? (
              <Choice title="Cards Lead With" options={fieldOptions(choices.live)} value={view.gallery_field} none="Nothing" onChange={(f) => onChange({ gallery_field: f })} />
            ) : null}
            {view.layout === "table" ? (
              <AdwSwitchRow
                title="Sheet"
                subtitle="Letter the columns and number the rows, so formulas can use =B7"
                active={view.coordinates === true}
                onNotifyActive={(active) => {
                  if (active !== (view.coordinates === true)) onChange(sheetPatch(!!active));
                }}
              />
            ) : null}
            {view.layout === "table" || view.layout === "list" ? (
              <Choice
                title="Group By"
                options={fieldOptions(choices.group)}
                value={view.group?.field}
                none="No Grouping"
                onChange={(f) => arrange({ group: f ? { field: f } : undefined })}
              />
            ) : null}
          </AdwPreferencesGroup>

          <AdwPreferencesGroup
            title="Filters"
            headerSuffix={
              <GtkButton
                iconName="list-add-symbolic"
                cssClasses={["flat"]}
                tooltipText="Add Filter"
                onClicked={() => {
                  const made = newFilter(choices.live);
                  if (made) arrange(filtersPatch([...filters, made]));
                }}
              />
            }
          >
            {filters.map((flt, i) => (
              <FilterRow
                key={i}
                filter={flt}
                fields={choices.live}
                onChange={(next) => arrange(filtersPatch(filters.map((f, j) => (j === i ? next : f))))}
                onRemove={() => arrange(filtersPatch(filters.filter((_, j) => j !== i)))}
              />
            ))}
          </AdwPreferencesGroup>

          <AdwPreferencesGroup
            title="Sorts"
            description={orderNote(view, sorts)}
            headerSuffix={
              <GtkButton
                iconName="list-add-symbolic"
                cssClasses={["flat"]}
                tooltipText="Add Sort"
                onClicked={() => {
                  const made = newSort(choices.live, sorts);
                  if (made) arrange(sortsPatch([...sorts, made]));
                }}
              />
            }
          >
            {sorts.map((srt, i) => (
              <SortRow
                key={i}
                sort={srt}
                fields={choices.live}
                onChange={(next) => arrange(sortsPatch(sorts.map((s, j) => (j === i ? next : s))))}
                onRemove={() => arrange(sortsPatch(sorts.filter((_, j) => j !== i)))}
              />
            ))}
          </AdwPreferencesGroup>

          {onArrange && personal ? (
            <AdwPreferencesGroup
              description={`Only you see this filter, sort and grouping.${view.coordinates === true ? " Row numbers and formulas follow the view as saved." : ""}`}
            >
              <GtkBox spacing={6}>
                {onSaveForEveryone ? <GtkButton label="Save for Everyone" cssClasses={["suggested-action"]} onClicked={onSaveForEveryone} /> : null}
                {onReset ? <GtkButton label="Reset" onClicked={onReset} /> : null}
              </GtkBox>
            </AdwPreferencesGroup>
          ) : null}

          {onDelete ? (
            <AdwPreferencesGroup>
              <GtkButton label="Delete View" cssClasses={["destructive-action"]} halign={Gtk.Align.START} onClicked={onDelete} />
            </AdwPreferencesGroup>
          ) : null}
        </AdwPreferencesPage>
      </AdwToolbarView>
    </AdwDialog>
  );
}
