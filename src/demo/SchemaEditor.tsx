import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { html, css } from "react-strict-dom";
import type { Field, FieldAlignment, FieldType } from "../core/types.js";
import { defaultAlignFor } from "../core/types.js";

/**
 * Fixed width for the "+ Field" trailing column slot. Body rows in
 * TableView render a matching-width spacer to keep columns aligned.
 *
 * NOTE: this literal is duplicated as `84` inside the StyleX rules below
 * and in views.tsx's spacer rule. StyleX is static-extraction only and
 * cannot resolve cross-module identifiers (it would interpret the import
 * as a `.stylex.js` theme variable). If you change this, update both
 * `addFieldWrapper.width` here and `addFieldSpacer.width` in views.tsx.
 */
export const ADD_FIELD_COLUMN_WIDTH = 84;

/**
 * User-facing labels for the spec's technical type vocabulary. The
 * on-disk type identifiers stay as-is (string, integer, etc.); these are
 * purely for UI presentation. Showing the technical name as a small
 * meta-tag alongside is intentional — power users and developers should
 * still be able to see what's actually written to schema.json.
 */
const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  string: "Text",
  integer: "Whole number",
  number: "Number",
  boolean: "Checkbox",
  date: "Date",
  datetime: "Date & time",
  time: "Time",
  year: "Year",
  array: "List",
  object: "Structured",
  duration: "Duration",
  geopoint: "Location",
  geojson: "Map shape",
};

function friendlyType(type: FieldType): string {
  return FIELD_TYPE_LABELS[type] ?? type;
}

const styles = css.create({
  popover: {
    position: "fixed",
    zIndex: 50,
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
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  popoverPosition: (top: number, left: number, width: number) => ({
    top,
    left,
    width,
  }),
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
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
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
  typeBadgeTechnical: {
    fontSize: 9,
    fontWeight: "400",
    textTransform: "none",
    opacity: 0.7,
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
  alignmentRow: {
    display: "flex",
    flexDirection: "row",
    gap: 4,
  },
  alignmentButton: {
    flex: 1,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "500",
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  alignmentButtonActive: {
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    borderColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
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
    justifyContent: "center",
    width: 84, // == ADD_FIELD_COLUMN_WIDTH; StyleX needs a literal
    flexShrink: 0,
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
  /** Trigger element's viewport rect (from getBoundingClientRect). */
  anchorRect: { top: number; left: number; right: number; bottom: number };
  onUpdate: (patch: Partial<Field>) => void;
  onAddEnumValue: (value: string) => void;
  onMove: (delta: -1 | 1) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 280;
const POPOVER_GAP = 6;

export function SchemaFieldEditor({
  field,
  fieldIndex,
  totalFields,
  align = "left",
  anchorRect,
  onUpdate,
  onAddEnumValue,
  onMove,
  onClose,
}: SchemaFieldEditorProps) {
  const ref = useDismiss(true, onClose);
  const [enumDraft, setEnumDraft] = useState("");

  // Compute viewport-coordinate position from the anchor's rect.
  const popoverTop = anchorRect.bottom + POPOVER_GAP;
  const popoverLeft =
    align === "right"
      ? Math.max(8, anchorRect.right - POPOVER_WIDTH)
      : Math.min(window.innerWidth - POPOVER_WIDTH - 8, anchorRect.left);

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

  return createPortal(
    <html.div
      ref={ref}
      style={[styles.popover, styles.popoverPosition(popoverTop, popoverLeft, POPOVER_WIDTH)]}
    >
      <html.div style={styles.identity}>
        <html.span>{field.name}</html.span>
        <html.span style={styles.typeBadge}>
          <html.span>{friendlyType(field.type)}</html.span>
          <html.span style={styles.typeBadgeTechnical}>· {field.type}</html.span>
        </html.span>
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

      <html.span style={styles.label}>
        Alignment <html.span style={styles.typeBadgeTechnical}>
          · auto = {defaultAlignFor(field.type)}
        </html.span>
      </html.span>
      <html.div style={styles.alignmentRow}>
        {(["auto", "left", "center", "right"] as const).map((opt) => {
          const isAuto = opt === "auto";
          const isActive = isAuto ? field.align === undefined : field.align === opt;
          return (
            <html.button
              key={opt}
              onClick={() =>
                onUpdate({ align: isAuto ? undefined : (opt as FieldAlignment) })
              }
              style={[
                styles.alignmentButton,
                isActive && styles.alignmentButtonActive,
              ]}
            >
              {isAuto ? "Auto" : opt[0]!.toUpperCase() + opt.slice(1)}
            </html.button>
          );
        })}
      </html.div>

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
    </html.div>,
    document.body,
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
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  const popoverTop = anchorRect ? anchorRect.bottom + POPOVER_GAP : 0;
  const popoverLeft = anchorRect
    ? Math.max(8, anchorRect.right - POPOVER_WIDTH)
    : 0;

  return (
    <html.div style={styles.addFieldWrapper}>
      {!open ? (
        <html.button
          ref={(el: HTMLButtonElement | null) => {
            triggerRef.current = el;
          }}
          onClick={() => {
            if (triggerRef.current) {
              setAnchorRect(triggerRef.current.getBoundingClientRect());
            }
            setOpen(true);
          }}
          style={styles.addFieldButton}
        >
          + Field
        </html.button>
      ) : (
        createPortal(
          <html.div
            ref={ref}
            style={[
              styles.popover,
              styles.popoverPosition(popoverTop, popoverLeft, POPOVER_WIDTH),
            ]}
          >
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
                {friendlyType(t)} · {t}
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
          </html.div>,
          document.body,
        )
      )}
    </html.div>
  );
}
