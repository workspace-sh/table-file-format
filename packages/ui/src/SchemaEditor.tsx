import { useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import type { CompileResult, Field, FieldAlignment, FieldType } from "@workspace.sh/table-core";
import {
  compileFormula,
  defaultAlignFor,
  enumOptions,
  enumValues,
  formulaType,
  printFormula,
} from "@workspace.sh/table-core";
import { Portal } from "./internal/Portal";
import { measureAnchor, type AnchorRect } from "./internal/measureAnchor";
import { useViewportHeight } from "./internal/useViewportHeight";
import { useViewportWidth } from "./internal/useViewportWidth";

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
  /**
   * Fullscreen transparent backdrop captures outside-tap dismiss. Inside
   * a `<Portal>` (web: detached from the table; native: inside an RN
   * Modal). Standard "press anywhere outside the popover to close"
   * pattern — replaces the web-only `document.addEventListener
   * ('mousedown')` approach the previous implementation used.
   */
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 49,
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    cursor: "default",
  },
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
  /** Placed above its trigger: anchored by its bottom edge, so its height doesn't matter. */
  popoverAbove: (bottom: number, left: number, width: number) => ({
    bottom,
    left,
    width,
  }),
  /** Never taller than the room it has; scrolls instead of running off-screen. */
  popoverMaxHeight: (maxHeight: number) => ({
    maxHeight,
    overflowY: "auto",
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
    paddingInline: 6,
    paddingBlock: 2,
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
    paddingInline: 8,
    paddingBlock: 6,
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
    paddingInline: 6,
    paddingBlock: 2,
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
    paddingBlock: 5,
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
    paddingInline: 8,
    paddingBlock: 6,
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
    paddingInline: 8,
    paddingBlock: 4,
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
  /** Formulas are code-shaped: monospace keeps brackets and operators legible. */
  formulaInput: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  warnText: {
    fontSize: 11,
    color: {
      default: "#9a6700",
      "@media (prefers-color-scheme: dark)": "#e3b341",
    },
  },
  hintText: {
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
});

const DIALECT = "table-expr-v1";

/** numeric, text or true/false — what a formula's type change actually changes. */
function typeFamily(t: FieldType): string {
  return t === "integer" || t === "number" ? "number" : t;
}

/**
 * The line under a formula box: why it can't be saved, what might go
 * wrong, or — once it compiles — exactly what the file will hold. Showing
 * the stored form keeps D29's two notations honest: what you typed is a
 * convenience, the bracketed form is the formula.
 */
function FormulaStatus({ result }: { result: CompileResult | null }) {
  if (result === null) return null;
  if (!result.ok) return <html.span style={styles.errorText}>{result.message}</html.span>;
  return (
    <>
      {result.warnings.map((w) => (
        <html.span key={w} style={styles.warnText}>
          {w}
        </html.span>
      ))}
      <html.span style={styles.hintText}>Stored as {result.stored}</html.span>
    </>
  );
}

interface SchemaFieldEditorProps {
  field: Field;
  fieldIndex: number;
  totalFields: number;
  align?: "left" | "right";
  /**
   * Trigger element's viewport-relative rect — produced by
   * `measureAnchor()`. `{ top, left, width, height }` rather than the
   * web-only DOMRect shape so the same prop works on native.
   */
  anchorRect: AnchorRect;
  onUpdate: (patch: Partial<Field>) => void;
  onAddEnumValue: (value: string) => void;
  onMove: (delta: -1 | 1) => void;
  onClose: () => void;
  /** The table's fields, so a formula can warn about a name that doesn't exist. */
  fields?: Field[];
}

const POPOVER_WIDTH = 280;
const POPOVER_GAP = 6;
/** Below this much room, a popover opens on whichever side has more. */
const POPOVER_COMFORTABLE_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;

/**
 * Which side of its trigger a popover opens on, and how tall it may be.
 *
 * A popover opened below a trigger near the bottom of the window runs
 * off-screen, taking its buttons with it — the "+ Field" popover did,
 * and its Add button couldn't be clicked. So it opens below when there's
 * comfortable room (or more room than above), otherwise above; and it is
 * capped at the room on that side, scrolling rather than overflowing.
 */
function placePopover(anchor: AnchorRect, viewportHeight: number) {
  const below = viewportHeight - (anchor.top + anchor.height) - POPOVER_GAP - VIEWPORT_MARGIN;
  const above = anchor.top - POPOVER_GAP - VIEWPORT_MARGIN;
  const openBelow = below >= POPOVER_COMFORTABLE_HEIGHT || below >= above;
  return openBelow
    ? { below: true as const, top: anchor.top + anchor.height + POPOVER_GAP, maxHeight: Math.max(120, below) }
    : { below: false as const, bottom: viewportHeight - anchor.top + POPOVER_GAP, maxHeight: Math.max(120, above) };
}

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
  fields,
}: SchemaFieldEditorProps) {
  const [enumDraft, setEnumDraft] = useState("");
  // A formula is edited in Excel style and saved in the stored form (D29).
  // Only a field that is already computed shows this: turning a stored
  // field into a formula would drop its data, and schemas only grow.
  const [formulaDraft, setFormulaDraft] = useState(() =>
    field.computed ? printFormula(field.computed.expr) : "",
  );
  const formula = field.computed
    ? compileFormula(formulaDraft, { fields: (fields ?? []).map((f) => f.name) })
    : null;
  const formulaChanged = formula?.ok === true && formula.stored !== field.computed?.expr;
  const saveFormula = () => {
    if (!formula?.ok || !formulaChanged) return;
    const types = new Map((fields ?? []).map((f) => [f.name, f.type] as const));
    const produced = formulaType(formula.expr, types);
    onUpdate({
      computed: { expr: formula.stored, dialect: DIALECT },
      // A formula rewritten from sums into text is a text column now.
      ...(typeFamily(produced) !== typeFamily(field.type) ? { type: produced } : {}),
    });
  };
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();

  // Below the trigger when there's room, above it when there isn't.
  const place = placePopover(anchorRect, viewportHeight);
  const anchorRight = anchorRect.left + anchorRect.width;
  const popoverLeft =
    align === "right"
      ? Math.max(8, anchorRight - POPOVER_WIDTH)
      : Math.min(viewportWidth - POPOVER_WIDTH - 8, anchorRect.left);

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
    // Membership check via the normalised values so the rich
    // { value, color, label } enum form deduplicates correctly too.
    if (enumValues(field).includes(value)) return;
    onAddEnumValue(value);
    setEnumDraft("");
  };

  return (
    <Portal>
      {/* Fullscreen backdrop — tap anywhere outside the popover closes it.
          html.button maps to <button> on web and Pressable on native, so
          the same onClick handler wires up correctly. */}
      <html.button onClick={onClose} style={styles.backdrop} />
      <html.div
        style={[
          styles.popover,
          place.below
            ? styles.popoverPosition(place.top, popoverLeft, POPOVER_WIDTH)
            : styles.popoverAbove(place.bottom, popoverLeft, POPOVER_WIDTH),
          styles.popoverMaxHeight(place.maxHeight),
        ]}
      >
        <html.div style={styles.identity}>
          <html.span>{field.name}</html.span>
          <html.span style={styles.typeBadge}>
            <html.span>{field.computed ? "Formula" : friendlyType(field.type)}</html.span>
            <html.span style={styles.typeBadgeTechnical}>· {field.type}</html.span>
          </html.span>
        </html.div>

        {field.computed && (
          <>
            <html.span style={styles.label}>Formula</html.span>
            <html.input
              type="text"
              value={formulaDraft}
              onChange={(e: { target: { value: string } }) => setFormulaDraft(e.target.value)}
              onKeyDown={(e: { key: string }) => {
                if (e.key === "Enter") saveFormula();
              }}
              style={[styles.input, styles.formulaInput]}
            />
            <FormulaStatus result={formula} />
            <html.div style={styles.actionRow}>
              <html.button
                disabled={!formulaChanged}
                onClick={saveFormula}
                style={[styles.button, formulaChanged && styles.primaryButton]}
              >
                Save formula
              </html.button>
            </html.div>
          </>
        )}

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
              {enumOptions(field).map((opt) => (
                <html.span key={opt.value} style={styles.enumPill}>
                  {opt.label ?? opt.value}
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
      </html.div>
    </Portal>
  );
}

interface AddFieldButtonProps {
  existingNames: Set<string>;
  onAdd: (field: Field) => void;
  /** The table's fields: a formula's references are checked against them. */
  fields?: Field[];
}

/** "Formula" sits beside the stored types in the picker; it isn't one. */
type AddableChoice = FieldType | "formula";

const ADDABLE_TYPES: FieldType[] = [
  "string",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime",
];

export function AddFieldButton({ existingNames, onAdd, fields }: AddFieldButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AddableChoice>("string");
  const [formulaDraft, setFormulaDraft] = useState("");
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  // Ref typed as `unknown` because the underlying instance differs per
  // platform (HTMLButtonElement on web, Pressable view ref on native).
  // measureAnchor() handles the platform-specific measurement internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triggerRef = useRef<any>(null);
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();

  const trimmed = name.trim();
  const duplicate = trimmed.length > 0 && existingNames.has(trimmed);
  const formula =
    type === "formula" && formulaDraft.trim() !== ""
      ? compileFormula(formulaDraft, { fields: [...existingNames] })
      : null;
  // A formula field can only be added once its formula compiles: nothing
  // that can't be stored in the canonical form is ever written (D29).
  const valid = trimmed.length > 0 && !duplicate && (type !== "formula" || formula?.ok === true);

  const submit = () => {
    if (!valid) return;
    if (type === "formula") {
      if (!formula?.ok) return;
      const types = new Map((fields ?? []).map((f) => [f.name, f.type] as const));
      onAdd({
        name: trimmed,
        type: formulaType(formula.expr, types),
        computed: { expr: formula.stored, dialect: DIALECT },
      });
    } else {
      onAdd({ name: trimmed, type });
    }
    setName("");
    setType("string");
    setFormulaDraft("");
    setOpen(false);
  };

  // Derive popover position from the anchor rect when open. AnchorRect
  // is {top, left, width, height} — derive right from left+width.
  const anchorRight = anchorRect ? anchorRect.left + anchorRect.width : 0;
  // "+ Field" sits at the foot of a table, often near the bottom of the
  // window: open upwards there rather than off-screen.
  const place = anchorRect ? placePopover(anchorRect, viewportHeight) : null;
  // Use viewport width to clamp the left edge so the popover doesn't
  // overflow the right edge of the screen.
  const desiredLeft = Math.max(8, anchorRight - POPOVER_WIDTH);
  const popoverLeft = anchorRect
    ? Math.min(viewportWidth - POPOVER_WIDTH - 8, desiredLeft)
    : 0;

  return (
    <html.div style={styles.addFieldWrapper}>
      <html.button
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(el: any) => {
          triggerRef.current = el;
        }}
        onClick={async () => {
          const rect = await measureAnchor(triggerRef.current);
          if (rect) setAnchorRect(rect);
          setOpen(true);
        }}
        style={styles.addFieldButton}
      >
        + Field
      </html.button>
      {open && anchorRect && (
        <Portal>
          <html.button onClick={() => setOpen(false)} style={styles.backdrop} />
          <html.div
            style={[
              styles.popover,
              place?.below === false
                ? styles.popoverAbove(place.bottom, popoverLeft, POPOVER_WIDTH)
                : styles.popoverPosition(place?.below ? place.top : 0, popoverLeft, POPOVER_WIDTH),
              styles.popoverMaxHeight(place?.maxHeight ?? 400),
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
              onChange={(e: { target: { value: string } }) => setType(e.target.value as AddableChoice)}
              style={styles.input}
            >
              {ADDABLE_TYPES.map((t) => (
                <html.option key={t} value={t}>
                  {friendlyType(t)} · {t}
                </html.option>
              ))}
              <html.option value="formula">Formula · computed</html.option>
            </html.select>

            {type === "formula" && (
              <>
                <html.span style={styles.label}>Formula</html.span>
                <html.input
                  type="text"
                  value={formulaDraft}
                  placeholder="=ROUND(budget / 12, 0)"
                  onChange={(e: { target: { value: string } }) => setFormulaDraft(e.target.value)}
                  onKeyDown={(e: { key: string }) => {
                    if (e.key === "Enter") submit();
                  }}
                  style={[styles.input, styles.formulaInput]}
                />
                <FormulaStatus result={formula} />
              </>
            )}

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
        </Portal>
      )}
    </html.div>
  );
}
