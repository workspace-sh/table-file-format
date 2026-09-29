// A view's settings (#86 step 6): its name and layout, the field a board,
// calendar or gallery is drawn from, whether a table is a sheet, and its
// filters, sorts and grouping (SPEC section 4). Every change is a patch to
// the view; the app keeps it with the table. With `onArrange`, filters,
// sorts and grouping are the reader's own until they save them for
// everyone (D4, D41): the app keeps those outside the table.

import { useState } from "react";
import type React from "react";
import { html, css } from "react-strict-dom";
import { Checkbox } from "./internal/Checkbox";
import { Select } from "./internal/Select";
import type { Field, FilterOperator, TableSchema, View, ViewFilter, ViewLayout, ViewSort } from "@workspace.sh/table-core";
import { enumOptions } from "@workspace.sh/table-core";

import {
  LAYOUTS,
  OPERATOR_LABELS,
  canUseLayout,
  filterValueFrom,
  filterValueText,
  layoutFieldFor,
  operatorsFor,
  takesValue,
} from "./viewEdit";

export interface ViewSettingsProps {
  view: View;
  schema: TableSchema;
  onChange: (patch: Partial<View>) => void;
  /** Absent when this is the table's only view: a table always has one. */
  onDelete?: () => void;
  onClose: () => void;
  /** Filters, sorts and grouping, as this reader's own. Absent: they change the view for everyone. */
  onArrange?: (patch: Partial<View>) => void;
  /** This reader's filters, sorts or grouping differ from the view as saved. */
  personal?: boolean;
  onSaveForEveryone?: () => void;
  onReset?: () => void;
}

const LAYOUT_LABELS: Record<ViewLayout, string> = {
  table: "Table",
  board: "Board",
  list: "List",
  gallery: "Gallery",
  calendar: "Calendar",
};

export function ViewSettings({
  view,
  schema,
  onChange,
  onDelete,
  onClose,
  onArrange,
  personal,
  onSaveForEveryone,
  onReset,
}: ViewSettingsProps) {
  const arrange = onArrange ?? onChange;
  const live = schema.fields.filter((f) => !f.deprecated);
  const byName = new Map(schema.fields.map((f) => [f.name, f]));
  const label = (f: Field) => f.title ?? f.name;
  const filters = view.filter ?? [];
  const sorts = view.sort ?? [];

  const setLayout = (layout: ViewLayout) => {
    const patch: Partial<View> = { layout };
    if (layout === "board" && !view.board_field) patch.board_field = layoutFieldFor("board", schema) ?? undefined;
    if (layout === "calendar" && !view.calendar_field) patch.calendar_field = layoutFieldFor("calendar", schema) ?? undefined;
    onChange(patch);
  };
  const setFilters = (next: ViewFilter[]) => arrange({ filter: next.length ? next : undefined });
  // A sort replaces any order rows were dragged into: choosing one says how
  // rows should run, and a manual order would silently win (SPEC section 4).
  const setSorts = (next: ViewSort[]) => arrange({ sort: next.length ? next : undefined, order: undefined });

  const dateFields = live.filter((f) => f.type === "date" || f.type === "datetime");
  const boardFields = live.filter((f) => f.type === "string" && !f.relation);

  return (
    <html.div style={styles.panel} role="dialog" aria-label="View settings">
      <html.div style={styles.row}>
        <html.span style={styles.heading}>View settings</html.span>
        <html.button style={styles.close} onClick={onClose} aria-label="Close view settings">
          ×
        </html.button>
      </html.div>

      <html.div style={styles.fields}>
        <FieldRow label="Name">
          <html.input
            type="text"
            value={view.name}
            onChange={(e: { target: { value: string } }) => onChange({ name: e.target.value })}
            style={styles.input}
          />
        </FieldRow>

        <FieldRow label="Layout">
        <Select
          value={view.layout}
          options={LAYOUTS.map((l) => ({
            value: l,
            label:
              LAYOUT_LABELS[l] +
              (canUseLayout(l, schema) ? "" : l === "calendar" ? " (needs a date field)" : " (needs a text field)"),
            disabled: !canUseLayout(l, schema),
          }))}
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
            <html.label style={styles.check}>
              <Checkbox
                checked={view.coordinates === true}
                onChange={(checked) => onChange({ coordinates: checked || undefined })}
              />
              <html.span>Letter the columns and number the rows, so formulas can use =B7</html.span>
            </html.label>
          </FieldRow>
        )}
        {(view.layout === "table" || view.layout === "list") && (
          <FieldRow label="Group by">
            <FieldSelect
              fields={live.filter((f) => !f.computed)}
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
          const first = live[0];
          if (first) setFilters([...filters, { field: first.name, operator: operatorsFor(first)[0]! }]);
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
          const used = new Set(sorts.map((s) => s.field));
          const next = live.find((f) => !used.has(f.name));
          if (next) setSorts([...sorts, { field: next.name, direction: "asc" }]);
        }}
      >
        + Add sort
      </html.button>
      {view.order && view.order.length > 0 && sorts.length === 0 && (
        <html.span style={styles.note}>Rows are in the order they were dragged into. Adding a sort replaces it.</html.span>
      )}

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
  const pickChoice =
    choices.length > 0 && ["eq", "neq", "contains", "not_contains"].includes(filter.operator);
  return (
    <html.div style={styles.row}>
      <FieldSelect
        fields={fields}
        value={filter.field}
        onChange={(name) => {
          if (!name) return;
          const next = fields.find((f) => f.name === name);
          const ops = operatorsFor(next);
          setDraft("");
          onChange({ field: name, operator: ops.includes(filter.operator) ? filter.operator : ops[0]! });
        }}
      />
      <Select
        value={filter.operator}
        options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
        onChange={(next) => {
          const operator = next as FilterOperator;
          const value = takesValue(operator) ? filterValueFrom(field, operator, draft) : undefined;
          onChange({ field: filter.field, operator, ...(value === undefined ? {} : { value }) });
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
            style={styles.input}
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
