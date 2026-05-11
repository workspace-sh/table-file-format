import { useEffect, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import { applyGroup } from "../core/index.js";
import type { Field, Row, TableSchema, View } from "../core/types.js";
import { AddFieldButton, SchemaFieldEditor } from "./SchemaEditor.js";

const styles = css.create({
  // Table
  table: {
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    borderRadius: 8,
    overflow: "hidden",
  },
  tableRow: {
    display: "flex",
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableHeaderRow: {
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
  },
  tableCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 13,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },

  // Kanban
  kanban: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    overflowX: "auto",
    paddingBottom: 8,
  },
  kanbanColumn: {
    display: "flex",
    flexDirection: "column",
    minWidth: 240,
    maxWidth: 280,
    padding: 12,
    borderRadius: 8,
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    gap: 8,
  },
  kanbanColumnHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  kanbanCount: {
    marginLeft: 6,
    fontSize: 11,
    fontWeight: "400",
  },

  // Gallery
  gallery: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  galleryCard: {
    minWidth: 240,
    maxWidth: 320,
    flex: 1,
  },
  galleryCardHero: {
    fontSize: 12,
    lineHeight: 1.4,
    color: {
      default: "#3c3c43",
      "@media (prefers-color-scheme: dark)": "#c7c7cc",
    },
    marginBottom: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },

  // List
  list: {
    display: "flex",
    flexDirection: "column",
  },
  listItem: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    gap: 12,
  },
  listItemLast: {
    borderBottomWidth: 0,
  },
  listItemTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  listItemSecondary: {
    fontSize: 12,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },

  // Card (shared by kanban + gallery)
  card: {
    display: "flex",
    flexDirection: "column",
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#0e0e10",
    },
    gap: 6,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  cardField: {
    display: "flex",
    flexDirection: "row",
    fontSize: 12,
    gap: 8,
  },
  cardFieldLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    minWidth: 56,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  cardFieldValue: {
    flex: 1,
    fontSize: 12,
  },

  // Pill (for enum values)
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "500",
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },

  // Clickable header cell wrapper
  headerCellWrapper: {
    position: "relative",
    display: "flex",
    flex: 1,
  },
  headerCellButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "transparent",
    borderWidth: 0,
    textAlign: "left",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  headerCellDeprecated: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },

  // Editable-cell input
  cellInput: {
    width: "100%",
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 13,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 4,
    borderColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    outlineStyle: "none",
  },
  cellEditable: {
    cursor: "text",
  },

  // "doc" badge for rows with a markdown body
  bodyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
    borderRadius: 4,
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    backgroundColor: {
      default: "#dbeafe",
      "@media (prefers-color-scheme: dark)": "#1e293b",
    },
    color: {
      default: "#1e40af",
      "@media (prefers-color-scheme: dark)": "#93c5fd",
    },
  },

  // Body excerpt (gallery cards)
  bodyExcerpt: {
    fontSize: 11,
    lineHeight: 1.45,
    color: {
      default: "#3c3c43",
      "@media (prefers-color-scheme: dark)": "#a1a1aa",
    },
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    marginTop: 4,
  },
});

function fieldsByName(schema: TableSchema): Map<string, Field> {
  return new Map(schema.fields.map((f) => [f.name, f]));
}

function visibleFields(view: View, schema: TableSchema): string[] {
  return view.fields ?? schema.fields.map((f) => f.name);
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function CellValue({ field, value }: { field: Field | undefined; value: unknown }) {
  const isEnum = field?.constraints?.enum != null;
  if (isEnum && value !== undefined && value !== null && value !== "") {
    return <html.span style={styles.pill}>{String(value)}</html.span>;
  }
  return <html.span>{formatValue(value)}</html.span>;
}

function coerceValue(field: Field | undefined, raw: string): unknown {
  if (!field) return raw;
  switch (field.type) {
    case "integer": {
      const n = Number(raw);
      return Number.isInteger(n) ? n : raw === "" ? null : raw;
    }
    case "number": {
      const n = Number(raw);
      return Number.isNaN(n) ? (raw === "" ? null : raw) : n;
    }
    case "boolean":
      return raw === "true";
    default:
      return raw;
  }
}

interface EditableCellProps {
  field: Field | undefined;
  value: unknown;
  onCommit: (next: unknown) => void;
}

function EditableCell({ field, value, onCommit }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (editing) {
      const el = inputRef.current;
      if (el && "select" in el && typeof el.select === "function") el.select();
      else el?.focus?.();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value === undefined || value === null ? "" : String(value));
    setEditing(true);
  };

  const commit = (raw: string) => {
    setEditing(false);
    const next = coerceValue(field, raw);
    if (next !== value) onCommit(next);
  };

  const cancel = () => setEditing(false);

  // Boolean: toggle on click, no draft state
  if (field?.type === "boolean") {
    return (
      <html.input
        type="checkbox"
        checked={value === true}
        onChange={(e: { target: { checked: boolean } }) => onCommit(e.target.checked)}
      />
    );
  }

  // Enum: select dropdown
  const enumValues = field?.constraints?.enum;
  if (enumValues && enumValues.length > 0) {
    if (!editing) {
      return (
        <html.span onClick={startEdit} style={styles.cellEditable}>
          <CellValue field={field} value={value} />
        </html.span>
      );
    }
    return (
      <html.select
        ref={inputRef as React.Ref<HTMLSelectElement>}
        value={typeof value === "string" ? value : ""}
        onChange={(e: { target: { value: string } }) => commit(e.target.value)}
        onBlur={cancel}
        style={styles.cellInput}
      >
        <html.option value="">—</html.option>
        {enumValues.map((opt) => (
          <html.option key={opt} value={opt}>
            {opt}
          </html.option>
        ))}
      </html.select>
    );
  }

  // Text/number/integer: text input on click
  if (!editing) {
    return (
      <html.span onClick={startEdit} style={styles.cellEditable}>
        <CellValue field={field} value={value} />
      </html.span>
    );
  }

  const inputType = field?.type === "integer" || field?.type === "number" ? "number" : "text";
  return (
    <html.input
      ref={inputRef as React.Ref<HTMLInputElement>}
      type={inputType}
      value={draft}
      onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e: { key: string }) => {
        if (e.key === "Enter") commit(draft);
        else if (e.key === "Escape") cancel();
      }}
      style={styles.cellInput}
    />
  );
}

interface ViewProps {
  view: View;
  rows: Row[];
  schema: TableSchema;
  bodies?: Record<string, string>;
  onUpdateRow?: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField?: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue?: (fieldName: string, value: string) => void;
  onMoveField?: (fieldName: string, delta: -1 | 1) => void;
  onAddField?: (field: Field) => void;
}

function bodyExcerpt(body: string | undefined, max = 160): string | undefined {
  if (!body) return undefined;
  const stripped = body
    .replace(/^#+\s+/gm, "") // drop leading markdown heading hashes
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function BodyBadge() {
  return <html.span style={styles.bodyBadge}>doc</html.span>;
}

export function TableView({
  view,
  rows,
  schema,
  bodies,
  onUpdateRow,
  onUpdateField,
  onAddEnumValue,
  onMoveField,
  onAddField,
}: ViewProps) {
  const fields = visibleFields(view, schema);
  const fieldMap = fieldsByName(schema);
  const titleField = fields[0];
  const [editingFieldName, setEditingFieldName] = useState<string | null>(null);
  const schemaEditable = !!(onUpdateField && onAddEnumValue && onMoveField);
  const canAddField = !!onAddField;

  return (
    <html.div style={styles.table}>
      <html.div style={[styles.tableRow, styles.tableHeaderRow]}>
        {fields.map((name) => {
          const field = fieldMap.get(name);
          const isEditing = editingFieldName === name;
          const fieldIndex = schema.fields.findIndex((f) => f.name === name);
          if (!schemaEditable) {
            return (
              <html.span key={name} style={[styles.tableCell, styles.tableHeaderCell]}>
                {field?.title ?? name}
              </html.span>
            );
          }
          return (
            <html.span key={name} style={styles.headerCellWrapper}>
              <html.button
                onClick={() => setEditingFieldName(isEditing ? null : name)}
                style={[
                  styles.headerCellButton,
                  field?.deprecated && styles.headerCellDeprecated,
                ]}
              >
                {field?.title ?? name}
              </html.button>
              {isEditing && field && (
                <SchemaFieldEditor
                  field={field}
                  fieldIndex={fieldIndex}
                  totalFields={schema.fields.length}
                  onUpdate={(patch) => onUpdateField!(name, patch)}
                  onAddEnumValue={(value) => onAddEnumValue!(name, value)}
                  onMove={(delta) => onMoveField!(name, delta)}
                  onClose={() => setEditingFieldName(null)}
                />
              )}
            </html.span>
          );
        })}
        {canAddField && (
          <AddFieldButton
            existingNames={new Set(schema.fields.map((f) => f.name))}
            onAdd={onAddField!}
          />
        )}
      </html.div>
      {rows.map((row, i) => (
        <html.div
          key={row.id}
          style={[styles.tableRow, i === rows.length - 1 && styles.tableRowLast]}
        >
          {fields.map((name) => (
            <html.span key={name} style={styles.tableCell}>
              {onUpdateRow ? (
                <EditableCell
                  field={fieldMap.get(name)}
                  value={row[name]}
                  onCommit={(next) => onUpdateRow(row.id, name, next)}
                />
              ) : (
                <CellValue field={fieldMap.get(name)} value={row[name]} />
              )}
              {name === titleField && bodies?.[row.id] ? <BodyBadge /> : null}
            </html.span>
          ))}
        </html.div>
      ))}
    </html.div>
  );
}

export function KanbanView({ view, rows, schema }: ViewProps) {
  const groupField = view.kanban_field ?? "status";
  const groups = applyGroup(rows, groupField, schema);
  const fields = visibleFields(view, schema).filter((f) => f !== groupField);
  const fieldMap = fieldsByName(schema);

  return (
    <html.div style={styles.kanban}>
      {Object.entries(groups).map(([key, groupRows]) => (
        <html.div key={key} style={styles.kanbanColumn}>
          <html.div style={styles.kanbanColumnHeader}>
            <html.span>{key}</html.span>
            <html.span style={styles.kanbanCount}>{groupRows.length}</html.span>
          </html.div>
          {groupRows.map((row) => (
            <Card key={row.id} row={row} fields={fields} fieldMap={fieldMap} />
          ))}
        </html.div>
      ))}
    </html.div>
  );
}

export function GalleryView({ view, rows, schema, bodies }: ViewProps) {
  const galleryField = view.gallery_field;
  const fields = visibleFields(view, schema).filter((f) => f !== galleryField);
  const fieldMap = fieldsByName(schema);

  return (
    <html.div style={styles.gallery}>
      {rows.map((row) => {
        const excerpt = bodyExcerpt(bodies?.[row.id]);
        return (
          <html.div key={row.id} style={[styles.card, styles.galleryCard]}>
            {galleryField && (
              <html.span style={styles.galleryCardHero}>
                {formatValue(row[galleryField])}
              </html.span>
            )}
            <CardBody row={row} fields={fields} fieldMap={fieldMap} hideTitle={!!galleryField} />
            {excerpt && <html.span style={styles.bodyExcerpt}>{excerpt}</html.span>}
          </html.div>
        );
      })}
    </html.div>
  );
}

export function ListView({ view, rows, schema, bodies }: ViewProps) {
  const fields = visibleFields(view, schema);
  const titleField = fields[0] ?? schema.fields[0]?.name;
  const secondaryFields = fields.slice(1);
  const fieldMap = fieldsByName(schema);

  return (
    <html.div style={styles.list}>
      {rows.map((row, i) => (
        <html.div
          key={row.id}
          style={[styles.listItem, i === rows.length - 1 && styles.listItemLast]}
        >
          <html.span style={styles.listItemTitle}>
            {titleField ? formatValue(row[titleField]) : ""}
            {bodies?.[row.id] ? <BodyBadge /> : null}
          </html.span>
          {secondaryFields.map((name) => (
            <html.span key={name} style={styles.listItemSecondary}>
              <CellValue field={fieldMap.get(name)} value={row[name]} />
            </html.span>
          ))}
        </html.div>
      ))}
    </html.div>
  );
}

interface CardProps {
  row: Row;
  fields: string[];
  fieldMap: Map<string, Field>;
}

function Card({ row, fields, fieldMap }: CardProps) {
  const titleField = fields[0];
  const restFields = fields.slice(1);
  return (
    <html.div style={styles.card}>
      {titleField && (
        <html.span style={styles.cardTitle}>{formatValue(row[titleField])}</html.span>
      )}
      <CardBody row={row} fields={restFields} fieldMap={fieldMap} hideTitle />
    </html.div>
  );
}

function CardBody({
  row,
  fields,
  fieldMap,
}: CardProps & { hideTitle?: boolean }) {
  return (
    <>
      {fields.map((name) => (
        <html.div key={name} style={styles.cardField}>
          <html.span style={styles.cardFieldLabel}>{name}</html.span>
          <html.span style={styles.cardFieldValue}>
            <CellValue field={fieldMap.get(name)} value={row[name]} />
          </html.span>
        </html.div>
      ))}
    </>
  );
}
