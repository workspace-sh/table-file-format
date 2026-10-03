// A view's settings (#86 step 6): its name and layout, the field a board,
// calendar or gallery is drawn from, whether a table is a sheet, and its
// filters, sorts and grouping (SPEC section 4). Every change is a patch to
// the view; the app keeps it with the table. With `onArrange`, filters,
// sorts and grouping are the reader's own until they save them for
// everyone (D4, D41): the app keeps those outside the table.

import { useState } from "react";
import type React from "react";
import { html, css } from "react-strict-dom";
import { Select, Toggle, usePlatformControls } from "./PlatformControls";
import type { Field, FilterOperator, TableSchema, View, ViewFilter, ViewLayout, ViewSort } from "@workspace.sh/table-core";
import { enumOptions } from "@workspace.sh/table-core";

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
  sheetPatch,
  orderNote,
} from "./viewEdit";

export type { ViewSettingsProps } from "./viewEdit";
import type { ViewSettingsProps } from "./viewEdit";


export function ViewSettings({
  view,
  schema,
  onChange,
  onDelete,
  onClose,
  onCancel,
  onArrange,
  personal,
  onSaveForEveryone,
  onReset,
}: ViewSettingsProps) {
  const { Sheet: SheetControl } = usePlatformControls();
  const arrange = onArrange ?? onChange;
  const choices = viewFieldChoices(schema);
  const live = choices.live;
  const byName = new Map(schema.fields.map((f) => [f.name, f]));
  const label = (f: Field) => f.title ?? f.name;
  const filters = view.filter ?? [];
  const sorts = view.sort ?? [];

  const setLayout = (layout: ViewLayout) => onChange(layoutPatch(view, schema, layout));
  const setFilters = (next: ViewFilter[]) => arrange(filtersPatch(next));
  const setSorts = (next: ViewSort[]) => arrange(sortsPatch(next));

  const dateFields = choices.date;
  const boardFields = choices.board;

  const body = (
    <>

      <html.div style={styles.fields}>
        <FieldRow label="Name">
          <html.input
            type="text"
            value={view.name}
            onChange={(e: { target: { value: string } }) => onChange({ name: e.target.value })}
            style={[styles.input, styles.textInput]}
          />
        </FieldRow>

        <FieldRow label="Layout">
        <Select
          value={view.layout}
          options={layoutOptions(schema)}
          onChange={(next) => setLayout(next as ViewLayout)}
          style={styles.input}
        />
        </FieldRow>

        {view.layout === "board" && (
          <FieldRow label="Columns from">
            <FieldSelect fields={boardFields} value={view.board_field} onChange={(f) => onChange({ board_field: f })} />
          </FieldRow>
        )}
        {view.layout === "calendar" && (
          <FieldRow label="Dates from">
            <FieldSelect fields={dateFields} value={view.calendar_field} onChange={(f) => onChange({ calendar_field: f })} />
          </FieldRow>
        )}
        {view.layout === "gallery" && (
          <FieldRow label="Card lead">
            <FieldSelect
              fields={live}
              value={view.gallery_field}
              none="Nothing"
              onChange={(f) => onChange({ gallery_field: f })}
            />
          </FieldRow>
        )}
        {view.layout === "table" && (
          <FieldRow label="Sheet">
            <Toggle
              role="setting"
              checked={view.coordinates === true}
              onChange={(checked) => onChange(sheetPatch(checked))}
              style={styles.check}
            >
              Letter the columns and number the rows, so formulas can use =B7
            </Toggle>
          </FieldRow>
        )}
        {(view.layout === "table" || view.layout === "list") && (
          <FieldRow label="Group by">
            <FieldSelect
              fields={choices.group}
              value={view.group?.field}
              none="No grouping"
              onChange={(f) => arrange({ group: f ? { field: f } : undefined })}
            />
          </FieldRow>
        )}
      </html.div>

      <html.span style={styles.section}>Filter</html.span>
      {filters.map((flt, i) => (
        <FilterRow
          key={i}
          filter={flt}
          fields={live}
          field={byName.get(flt.field)}
          label={label}
          onChange={(next) => setFilters(filters.map((f, j) => (j === i ? next : f)))}
          onRemove={() => setFilters(filters.filter((_, j) => j !== i))}
        />
      ))}
      <html.button
        style={styles.add}
        onClick={() => {
          const made = newFilter(live);
          if (made) setFilters([...filters, made]);
        }}
      >
        + Add filter
      </html.button>
      {filters.length > 1 && <html.span style={styles.note}>Rows must match every filter.</html.span>}

      <html.span style={styles.section}>Sort</html.span>
      {sorts.map((srt, i) => (
        <html.div key={i} style={styles.row}>
          <FieldSelect
            fields={live}
            value={srt.field}
            onChange={(f) => f && setSorts(sorts.map((s, j) => (j === i ? { ...s, field: f } : s)))}
          />
          <Select
            value={srt.direction}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            onChange={(next) =>
              setSorts(sorts.map((s, j) => (j === i ? { ...s, direction: next as "asc" | "desc" } : s)))
            }
            style={styles.input}
          />
          <html.button style={styles.remove} aria-label="Remove sort" onClick={() => setSorts(sorts.filter((_, j) => j !== i))}>
            ×
          </html.button>
        </html.div>
      ))}
      <html.button
        style={styles.add}
        onClick={() => {
          const made = newSort(live, sorts);
          if (made) setSorts([...sorts, made]);
        }}
      >
        + Add sort
      </html.button>
      {orderNote(view, sorts) && <html.span style={styles.note}>{orderNote(view, sorts)}</html.span>}

      {onArrange && personal && (
        <html.div style={styles.personal} role="status">
          <html.span style={styles.personalText}>
            Only you see this filter, sort and grouping.{view.coordinates === true ? " Row numbers and formulas follow the view as saved." : ""}
          </html.span>
          {onSaveForEveryone && (
            <html.button style={styles.save} onClick={onSaveForEveryone}>
              Save for everyone
            </html.button>
          )}
          {onReset && (
            <html.button style={styles.reset} onClick={onReset}>
              Reset
            </html.button>
          )}
        </html.div>
      )}

      {onDelete && (
        <html.button
          style={styles.delete}
          onClick={onDelete}
        >
          Delete this view
        </html.button>
      )}
    </>
  );

  // On a phone, the platform's settings sheet, with Done; elsewhere a panel
  // in the page, with its own heading and close button.
  if (SheetControl.presentsSettings) {
    return (
      <SheetControl
        size="settings"
        title="View settings"
        cancel={onCancel && { label: "Cancel", onPress: onCancel }}
        confirm={{ label: "Done", onPress: onClose }}
        dismissible
        onDismiss={onClose}
      >
        <html.div style={styles.sheetBody}>{body}</html.div>
      </SheetControl>
    );
  }
  return (
    <html.div style={styles.panel} role="dialog" aria-label="View settings">
      <html.div style={styles.row}>
        <html.span style={styles.heading}>View settings</html.span>
        <html.button style={styles.close} onClick={onClose} aria-label="Close view settings">
          ×
        </html.button>
      </html.div>
      {body}
    </html.div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <html.div style={styles.field}>
      <html.span style={styles.label}>{label}</html.span>
      {children}
    </html.div>
  );
}

function FieldSelect({
  fields,
  value,
  onChange,
  none,
}: {
  fields: Field[];
  value: string | undefined;
  onChange: (field: string | undefined) => void;
  none?: string;
}) {
  return (
    <Select
      value={value ?? ""}
      options={[
        ...(none !== undefined ? [{ value: "", label: none }] : []),
        ...fields.map((f) => ({ value: f.name, label: f.title ?? f.name })),
      ]}
      onChange={(next) => onChange(next || undefined)}
      style={styles.input}
    />
  );
}

function FilterRow({
  filter,
  fields,
  field,
  onChange,
  onRemove,
}: {
  filter: ViewFilter;
  fields: Field[];
  field: Field | undefined;
  label: (f: Field) => string;
  onChange: (next: ViewFilter) => void;
  onRemove: () => void;
}) {
  const operators = operatorsFor(field);
  const choices = enumOptions(field);
  // What's typed, kept as typed, so "1," on the way to "1, 2" isn't
  // tidied away under the cursor. The stored value follows it.
  const [draft, setDraft] = useState(() => filterValueText(filter.value));
  // One choice from the list: equal to it, or (for a multi-select) having it.
  const pickChoice = picksChoice(field, filter.operator);
  return (
    <html.div style={styles.row}>
      <FieldSelect
        fields={fields}
        value={filter.field}
        onChange={(name) => {
          if (!name) return;
          const next = fields.find((f) => f.name === name);
          if (!next) return;
          setDraft("");
          onChange(filterOnField(filter, next));
        }}
      />
      <Select
        value={filter.operator}
        options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
        onChange={(next) => {
          onChange(filterWithOperator(filter, field, next as FilterOperator, draft));
        }}
        style={styles.input}
      />
      {takesValue(filter.operator) &&
        (pickChoice ? (
          <Select
            value={String(filter.value ?? "")}
            options={[
              { value: "", label: "Choose…" },
              ...choices.map((c) => ({ value: c.value, label: c.label ?? c.value })),
            ]}
            onChange={(next) => onChange({ ...filter, value: next })}
            style={styles.input}
          />
        ) : (
          <html.input
            type="text"
            value={draft}
            placeholder={filter.operator === "in" || filter.operator === "not_in" ? "a, b, c" : "Value"}
            onChange={(e: { target: { value: string } }) => {
              setDraft(e.target.value);
              onChange({ ...filter, value: filterValueFrom(field, filter.operator, e.target.value) });
            }}
            style={[styles.input, styles.textInput]}
          />
        ))}
      <html.button style={styles.remove} aria-label="Remove filter" onClick={onRemove}>
        ×
      </html.button>
    </html.div>
  );
}

const styles = css.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 16,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#17171a" },
    maxWidth: 720,
  },
  row: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  // In a phone's sheet: the panel's spacing without its frame.
  sheetBody: { display: "flex", flexDirection: "column", gap: 8 },
  fields: { display: "flex", flexDirection: "column", gap: 8 },
  field: { display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  heading: { flex: 1, fontSize: 14, fontWeight: "600" },
  section: {
    marginTop: 6,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  label: { width: 110, flexShrink: 0, fontSize: 12, color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" } },
  input: {
    fontSize: 12,
    paddingInline: 8,
    paddingBlock: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1f" },
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  // Room for a few words. React Native sizes a text field to what's typed,
  // so without it a name or a filter's value is cut short. A browser's text
  // field is already wider: 125px inside its padding (min-width counts only
  // that there, the whole box on native), so the web doesn't change.
  textInput: { minWidth: 120 },
  check: { display: "flex", flexDirection: "row", alignItems: "center", gap: 6, fontSize: 12 },
  add: {
    alignSelf: "flex-start",
    fontSize: 12,
    paddingInline: 8,
    paddingBlock: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    backgroundColor: "transparent",
    cursor: "pointer",
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  remove: {
    fontSize: 14,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" },
  },
  close: { fontSize: 16, borderWidth: 0, backgroundColor: "transparent", cursor: "pointer", color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" } },
  note: { fontSize: 11, color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#6e6e73" } },
  personal: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
    paddingInline: 10,
    paddingBlock: 8,
    borderRadius: 8,
    backgroundColor: { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#222226" },
  },
  personalText: { flexGrow: 1, flexBasis: 220, fontSize: 12, color: { default: "#3a3a3c", "@media (prefers-color-scheme: dark)": "#d1d1d6" } },
  save: {
    fontSize: 12,
    fontWeight: "600",
    paddingInline: 10,
    paddingBlock: 5,
    borderRadius: 6,
    borderWidth: 0,
    cursor: "pointer",
    color: "#ffffff",
    backgroundColor: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" },
  },
  reset: {
    fontSize: 12,
    paddingInline: 10,
    paddingBlock: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    backgroundColor: "transparent",
    cursor: "pointer",
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  delete: {
    alignSelf: "flex-start",
    marginTop: 8,
    fontSize: 12,
    paddingInline: 10,
    paddingBlock: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#f3c2c2", "@media (prefers-color-scheme: dark)": "#5a2a2a" },
    backgroundColor: "transparent",
    cursor: "pointer",
    color: { default: "#c00", "@media (prefers-color-scheme: dark)": "#ff6b6b" },
  },
});
