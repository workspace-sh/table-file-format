import { useEffect, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import type { Field, FieldType } from "../core/types.js";

const styles = css.create({
  popover: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 10,
    marginTop: 6,
    minWidth: 260,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  popoverRightAligned: {
    left: "auto",
    right: 0,
  },
  identity: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 12,
    fontWeight: "600",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    backgroundColor: {
      default: "#f5f5f7",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  input: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 4,
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    outlineStyle: "none",
  },
  checkRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
  },
  enumRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
    marginBottom: 4,
  },
  enumPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  actionRow: {
    display: "flex",
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  button: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "500",
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    cursor: "pointer",
  },
  primaryButton: {
    backgroundColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    borderColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    color: "#ffffff",
  },
  addFieldWrapper: {
    position: "relative",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  addFieldButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "600",
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: "transparent",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
    cursor: "pointer",
  },
  errorText: {
    fontSize: 11,
    color: {
      default: "#c00",
      "@media (prefers-color-scheme: dark)": "#ff6b6b",
    },
  },
});

function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

interface SchemaFieldEditorProps {
  field: Field;
  fieldIndex: number;
  totalFields: number;
  align?: "left" | "right";
  onUpdate: (patch: Partial<Field>) => void;
  onAddEnumValue: (value: string) => void;
  onMove: (delta: -1 | 1) => void;
  onClose: () => void;
}

export function SchemaFieldEditor({
  field,
  fieldIndex,
  totalFields,
  align = "left",
  onUpdate,
  onAddEnumValue,
  onMove,
  onClose,
}: SchemaFieldEditorProps) {
  const ref = useDismiss(true, onClose);
  const [enumDraft, setEnumDraft] = useState("");

  const hasEnum = Array.isArray(field.constraints?.enum);

  const setRequired = (next: boolean) => {
    const c = { ...(field.constraints ?? {}) };
    if (next) c.required = true;
    else delete c.required;
    onUpdate({ constraints: Object.keys(c).length ? c : undefined });
  };

  const submitEnumValue = () => {
    const value = enumDraft.trim();
    if (!value) return;
    if (field.constraints?.enum?.includes(value)) return;
    onAddEnumValue(value);
    setEnumDraft("");
  };

  return (
    <html.div
      ref={ref}
      style={[styles.popover, align === "right" && styles.popoverRightAligned]}
    >
      <html.div style={styles.identity}>
        <html.span>{field.name}</html.span>
        <html.span style={styles.typeBadge}>{field.type}</html.span>
      </html.div>

      <html.span style={styles.label}>Display title</html.span>
      <html.input
        type="text"
        value={field.title ?? ""}
        placeholder={field.name}
        onChange={(e: { target: { value: string } }) =>
          onUpdate({ title: e.target.value || undefined })
        }
        style={styles.input}
      />

      <html.span style={styles.label}>Description</html.span>
      <html.input
        type="text"
        value={field.description ?? ""}
        onChange={(e: { target: { value: string } }) =>
          onUpdate({ description: e.target.value || undefined })
        }
        style={styles.input}
      />

      <html.div style={styles.checkRow}>
        <html.input
          type="checkbox"
          checked={field.constraints?.required === true}
          onChange={(e: { target: { checked: boolean } }) => setRequired(e.target.checked)}
        />
        <html.span>Required</html.span>
      </html.div>

      <html.div style={styles.checkRow}>
        <html.input
          type="checkbox"
          checked={field.deprecated === true}
          onChange={(e: { target: { checked: boolean } }) =>
            onUpdate({ deprecated: e.target.checked || undefined })
          }
        />
        <html.span>Deprecated</html.span>
      </html.div>

      {hasEnum && (
        <>
          <html.span style={styles.label}>Enum values</html.span>
          <html.div style={styles.enumRow}>
            {field.constraints!.enum!.map((v) => (
              <html.span key={v} style={styles.enumPill}>
                {v}
              </html.span>
            ))}
          </html.div>
          <html.input
            type="text"
            value={enumDraft}
            placeholder="Add value, press Enter"
            onChange={(e: { target: { value: string } }) => setEnumDraft(e.target.value)}
            onKeyDown={(e: { key: string }) => {
              if (e.key === "Enter") submitEnumValue();
            }}
            style={styles.input}
          />
        </>
      )}

      <html.div style={styles.actionRow}>
        <html.button
          disabled={fieldIndex === 0}
          onClick={() => onMove(-1)}
          style={styles.button}
        >
          ↑ Move up
        </html.button>
        <html.button
          disabled={fieldIndex >= totalFields - 1}
          onClick={() => onMove(1)}
          style={styles.button}
        >
          ↓ Move down
        </html.button>
      </html.div>
    </html.div>
  );
}

interface AddFieldButtonProps {
  existingNames: Set<string>;
  onAdd: (field: Field) => void;
}

const ADDABLE_TYPES: FieldType[] = [
  "string",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime",
];

export function AddFieldButton({ existingNames, onAdd }: AddFieldButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("string");
  const ref = useDismiss(open, () => setOpen(false));

  const trimmed = name.trim();
  const duplicate = trimmed.length > 0 && existingNames.has(trimmed);
  const valid = trimmed.length > 0 && !duplicate;

  const submit = () => {
    if (!valid) return;
    onAdd({ name: trimmed, type });
    setName("");
    setType("string");
    setOpen(false);
  };

  return (
    <html.div style={styles.addFieldWrapper}>
      {!open ? (
        <html.button onClick={() => setOpen(true)} style={styles.addFieldButton}>
          + Field
        </html.button>
      ) : (
        <html.div ref={ref} style={[styles.popover, styles.popoverRightAligned]}>
          <html.span style={styles.label}>Name</html.span>
          <html.input
            type="text"
            value={name}
            placeholder="e.g. priority"
            onChange={(e: { target: { value: string } }) => setName(e.target.value)}
            onKeyDown={(e: { key: string }) => {
              if (e.key === "Enter") submit();
            }}
            style={styles.input}
          />

          <html.span style={styles.label}>Type</html.span>
          <html.select
            value={type}
            onChange={(e: { target: { value: string } }) => setType(e.target.value as FieldType)}
            style={styles.input}
          >
            {ADDABLE_TYPES.map((t) => (
              <html.option key={t} value={t}>
                {t}
              </html.option>
            ))}
          </html.select>

          {duplicate && <html.span style={styles.errorText}>Name already in use</html.span>}

          <html.div style={styles.actionRow}>
            <html.button
              disabled={!valid}
              onClick={submit}
              style={[styles.button, valid && styles.primaryButton]}
            >
              Add field
            </html.button>
            <html.button onClick={() => setOpen(false)} style={styles.button}>
              Cancel
            </html.button>
          </html.div>
        </html.div>
      )}
    </html.div>
  );
}
