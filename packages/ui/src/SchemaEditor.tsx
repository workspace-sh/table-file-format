import { useEffect, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import { Checkbox } from "./internal/Checkbox";
import { Select } from "./internal/Select";
import type { CompileResult, ComputeOptions, Field, Grid, Row } from "@workspace.sh/table-core";
import type { ReactNode } from "react";
import {
  defaultAlignFor,
  enumOptions,
  printFormula,
} from "@workspace.sh/table-core";
import { Portal } from "./internal/Portal";
import { explainFormula, formulaDraftOf, formulaStatus } from "./formulaCell";
import {
  addableChoices,
  ALIGN_CHOICES,
  alignLabel,
  alignPatch,
  currencyCodes,
  currencyName,
  fieldFormula,
  formatState,
  friendlyType,
  newChoice,
  newField,
  requiredPatch,
  takesChoices,
  type AddableChoice,
} from "./fieldEdit";
import { useDirection, useDisplaySettings } from "./DisplaySettings";
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



export { friendlyType };

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
  /** "+" at the end of the header row, just outside the table. */
  addFieldCompactWrapper: {
    position: "relative",
    display: "flex",
    flexShrink: 0,
  },
  addFieldCompact: {
    width: 30,
    height: 30,
    fontSize: 18,
    lineHeight: "18px",
    borderRadius: 6,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: "#ececf0", "@media (prefers-color-scheme: dark)": "#1f1f23" },
    },
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  fieldNameInput: {
    fontSize: 14,
  },
  typeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 4,
  },
  typeChoice: {
    paddingInline: 8,
    paddingBlock: 6,
    fontSize: 12,
    textAlign: "start",
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#2c2c31",
    },
    backgroundColor: "transparent",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  typeChoiceOn: {
    borderColor: "#0a84ff",
    backgroundColor: {
      default: "#eaf3ff",
      "@media (prefers-color-scheme: dark)": "#0f2744",
    },
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
  inputRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
  },
  inputName: {
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  resultRow: {
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#2c2c30",
    },
    fontWeight: "600",
  },
  previewRow: {
    fontWeight: "600",
    color: {
      default: "#0a84ff",
      "@media (prefers-color-scheme: dark)": "#4aa3ff",
    },
  },
  linkButton: {
    alignSelf: "flex-start",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 11,
    cursor: "pointer",
    color: {
      default: "#0a84ff",
      "@media (prefers-color-scheme: dark)": "#4aa3ff",
    },
  },
  /** Plain explanatory text; hintText is for code-shaped content. */
  noteText: {
    fontSize: 11,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
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


/** numeric, text or true/false — what a formula's type change actually changes. */

/**
 * The line under a formula box: why it can't be saved, what might go
 * wrong, or — once it compiles — exactly what the file will hold. Showing
 * the stored form keeps D29's two notations honest: what you typed is a
 * convenience, the bracketed form is the formula. When what was typed
 * already is the stored form, the line would only repeat it (#76).
 */
function FormulaStatus({ result, typed }: { result: CompileResult | null; typed: string }) {
  if (result === null) return null;
  const status = formulaStatus(result, typed);
  if (status.kind === "error") return <html.span style={styles.errorText}>{status.message}</html.span>;
  return (
    <>
      {status.warnings.map((w) => (
        <html.span key={w} style={styles.warnText}>
          {w}
        </html.span>
      ))}
      {status.storedAs === undefined ? null : <html.span style={styles.hintText}>Stored as {status.storedAs}</html.span>}
    </>
  );
}

// ---- display formats (SPEC section 2, "Field format")



/**
 * Choose how a column's values are shown — never what is stored. Values
 * stay raw (SPEC section 2); `format` is a token from a closed vocabulary
 * that any reader renders with Intl. Currency is an ISO 4217 code, so a
 * .table written here reads the same in any app that follows the spec.
 */
function FormatPicker({
  field,
  fields,
  onUpdate,
}: {
  field: Field;
  fields: Field[];
  onUpdate: (patch: Partial<Field>) => void;
}) {
  const display = useDisplaySettings();
  const state = formatState(field, fields, display);
  if (!state) return null;
  const { kind, digits, code, notes } = state;
  const shown = state.choices;
  const choose = (next: string) => onUpdate(state.choose(next));
  const set = (format: string) => onUpdate({ format: format || undefined });
  return (
    <>
      <html.span style={styles.label}>Format</html.span>
      <Select
        value={kind}
        options={shown.map((o) => ({ value: o.value, label: o.label }))}
        onChange={choose}
        style={styles.input}
      />
      {kind === "decimal" && (
        <Select
          value={String(digits)}
          options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({
            value: String(d),
            label: `${d} decimal place${d === 1 ? "" : "s"}`,
          }))}
          onChange={(next) => set(`decimal:${next}`)}
          style={styles.input}
        />
      )}
      {kind === "currency" && (
        <Select
          value={code}
          options={currencyCodes().map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }))}
          onChange={(next) => set(`currency:${next}`)}
          style={styles.input}
        />
      )}
      {notes.map((n) => (
        <html.span key={n.text} style={n.kind === "warn" ? styles.warnText : styles.noteText}>
          {n.text}
        </html.span>
      ))}
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
  /** The sheet, when the view shows coordinates: `=B7` can be typed and is shown (D34). */
  grid?: Grid;
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
  grid,
}: SchemaFieldEditorProps) {
  const [enumDraft, setEnumDraft] = useState("");
  // A formula is shown in the app's chosen syntax, typed in either, and
  // saved in the stored form (D29, #76). Only a field that is already
  // computed shows this: turning a stored field into a formula would drop
  // its data, and schemas only grow.
  const { formulaSyntax } = useDisplaySettings();
  const rtl = useDirection() === "rtl";
  const [formulaDraft, setFormulaDraft] = useState(() =>
    field.computed ? printFormula(field.computed.expr, { grid, syntax: formulaSyntax }) : "",
  );
  const formulaEdit = field.computed ? fieldFormula(field, fields ?? [], formulaDraft, grid) : null;
  const formula = formulaEdit?.compiled ?? null;
  const formulaChanged = formulaEdit?.save !== undefined;
  const saveFormula = () => {
    if (formulaEdit?.save) onUpdate(formulaEdit.save);
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

  // A list field can always gain choices: that's what makes it a multi-select (D35).
  const hasEnum = takesChoices(field);

  const setRequired = (next: boolean) => onUpdate(requiredPatch(field, next));

  const submitEnumValue = () => {
    const value = newChoice(field, enumDraft);
    if (value === null) return;
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
        dir="auto"
              type="text"
              value={formulaDraft}
              onChange={(e: { target: { value: string } }) => setFormulaDraft(e.target.value)}
              onKeyDown={(e: { key: string }) => {
                if (e.key === "Enter") saveFormula();
              }}
              style={[styles.input, styles.formulaInput]}
            />
            <FormulaStatus result={formula} typed={formulaDraft} />
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
        dir="auto"
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
        dir="auto"
          type="text"
          value={field.description ?? ""}
          onChange={(e: { target: { value: string } }) =>
            onUpdate({ description: e.target.value || undefined })
          }
          style={styles.input}
        />

        <FormatPicker field={field} fields={fields ?? []} onUpdate={onUpdate} />

        <html.div style={styles.checkRow}>
          <Checkbox checked={field.constraints?.required === true} onChange={setRequired} />
          <html.span>Required</html.span>
        </html.div>

        <html.div style={styles.checkRow}>
          <Checkbox checked={field.deprecated === true} onChange={(checked) => onUpdate({ deprecated: checked || undefined })} />
          <html.span>Deprecated</html.span>
        </html.div>

        {hasEnum && (
          <>
            <html.span style={styles.label}>{field.type === "array" ? "Choices (each item is one of these)" : "Enum values"}</html.span>
            <html.div style={styles.enumRow}>
              {enumOptions(field).map((opt) => (
                <html.span key={opt.value} style={styles.enumPill}>
                  {opt.label ?? opt.value}
                </html.span>
              ))}
            </html.div>
            <html.input
        dir="auto"
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
            · auto = {alignLabel(defaultAlignFor(field.type), rtl).toLowerCase()}
          </html.span>
        </html.span>
        <html.div style={styles.alignmentRow}>
          {ALIGN_CHOICES.map((opt) => {
            const isAuto = opt === "auto";
            const isActive = isAuto ? field.align === undefined : field.align === opt;
            return (
              <html.button
                key={opt}
                onClick={() => onUpdate(alignPatch(opt))}
                style={[
                  styles.alignmentButton,
                  isActive && styles.alignmentButtonActive,
                ]}
              >
                {isAuto ? "Auto" : alignLabel(opt, rtl)}
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
  /** The sheet, when the view shows coordinates (D34). */
  grid?: Grid;
  /** A small "+" at the end of the header row, not a labelled button. */
  compact?: boolean;
}


export function AddFieldButton({ existingNames, onAdd, fields, grid, compact }: AddFieldButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AddableChoice>("string");
  const [formulaDraft, setFormulaDraft] = useState("");
  const { formulaSyntax } = useDisplaySettings();
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  // Ref typed as `unknown` because the underlying instance differs per
  // platform (HTMLButtonElement on web, Pressable view ref on native).
  // measureAnchor() handles the platform-specific measurement internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triggerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameRef = useRef<any>(null);
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();

  // What's typed is the column's title; its stored key is made from it,
  // never clashing, so there's no "name in use" to fix by hand.
  const trimmed = name.trim();
  // A formula field can only be added once its formula compiles: nothing
  // that can't be stored in the canonical form is ever written (D29).
  const made = newField({ name, type, formula: formulaDraft, existing: existingNames, fields: fields ?? [], grid });
  const key = made.key;
  const formula = made.compiled;
  const valid = made.field !== null;

  const close = () => {
    setName("");
    setType("string");
    setFormulaDraft("");
    setOpen(false);
  };

  // Open: typing goes straight into the name, and Escape closes.
  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus?.();
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = () => {
    if (!made.field) return;
    onAdd(made.field);
    close();
  };

  // Derive popover position from the anchor rect when open. AnchorRect
  // is {top, left, width, height} — derive right from left+width.
  const anchorRight = anchorRect ? anchorRect.left + anchorRect.width : 0;
  // Near the bottom of the window it opens upwards rather than off-screen.
  const place = anchorRect ? placePopover(anchorRect, viewportHeight) : null;
  // Use viewport width to clamp the left edge so the popover doesn't
  // overflow the right edge of the screen.
  const desiredLeft = Math.max(8, anchorRight - POPOVER_WIDTH);
  const popoverLeft = anchorRect
    ? Math.min(viewportWidth - POPOVER_WIDTH - 8, desiredLeft)
    : 0;

  const choices = addableChoices();

  return (
    <html.div style={compact ? styles.addFieldCompactWrapper : styles.addFieldWrapper}>
      <html.button
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={(el: any) => {
          triggerRef.current = el;
        }}
        aria-label="Add a field"
        onClick={async () => {
          const rect = await measureAnchor(triggerRef.current);
          if (rect) setAnchorRect(rect);
          setOpen(true);
        }}
        style={compact ? styles.addFieldCompact : styles.addFieldButton}
      >
        {compact ? "+" : "+ Field"}
      </html.button>
      {open && anchorRect && (
        <Portal>
          <html.button onClick={close} style={styles.backdrop} />
          <html.div
            style={[
              styles.popover,
              place?.below === false
                ? styles.popoverAbove(place.bottom, popoverLeft, POPOVER_WIDTH)
                : styles.popoverPosition(place?.below ? place.top : 0, popoverLeft, POPOVER_WIDTH),
              styles.popoverMaxHeight(place?.maxHeight ?? 400),
            ]}
          >
            <html.input
        dir="auto"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ref={(el: any) => {
                nameRef.current = el;
              }}
              type="text"
              value={name}
              aria-label="Field name"
              placeholder="Field name"
              onChange={(e: { target: { value: string } }) => setName(e.target.value)}
              onKeyDown={(e: { key: string }) => {
                if (e.key === "Enter") submit();
              }}
              style={[styles.input, styles.fieldNameInput]}
            />
            {trimmed.length > 0 && key !== trimmed ? (
              <html.span style={styles.hintText}>Stored as {key}</html.span>
            ) : null}

            <html.span style={styles.label}>Type</html.span>
            <html.div role="radiogroup" aria-label="Field type" style={styles.typeGrid}>
              {choices.map((c) => (
                <html.button
                  key={c.value}
                  role="radio"
                  aria-checked={type === c.value}
                  onClick={() => setType(c.value)}
                  style={[styles.typeChoice, type === c.value && styles.typeChoiceOn]}
                >
                  {c.label}
                </html.button>
              ))}
            </html.div>

            {type === "formula" && (
              <>
                <html.span style={styles.label}>Formula</html.span>
                <html.input
        dir="auto"
                  type="text"
                  value={formulaDraft}
                  placeholder={formulaSyntax === "stored" ? "(round (/ budget 12) 0)" : "=round(budget / 12, 0)"}
                  onChange={(e: { target: { value: string } }) => setFormulaDraft(e.target.value)}
                  onKeyDown={(e: { key: string }) => {
                    if (e.key === "Enter") submit();
                  }}
                  style={[styles.input, styles.formulaInput]}
                />
                <FormulaStatus result={formula} typed={formulaDraft} />
              </>
            )}

            <html.div style={styles.actionRow}>
              <html.button
                disabled={!valid}
                onClick={submit}
                style={[styles.button, valid && styles.primaryButton]}
              >
                Add field
              </html.button>
              <html.button onClick={close} style={styles.button}>
                Cancel
              </html.button>
            </html.div>
          </html.div>
        </Portal>
      )}
    </html.div>
  );
}

interface FormulaCellPanelProps {
  field: Field;
  /** The row as displayed — computed values already filled in. */
  row: Record<string, unknown>;
  fields: Field[];
  anchorRect: AnchorRect;
  /** Render one of this row's values the way its cell shows it. */
  renderValue: (fieldName: string, value: unknown) => ReactNode;
  /**
   * Save a new formula for the column. Absent when the schema can't be
   * edited here, and the panel is read-only.
   */
  onSave?: (patch: Partial<Field>) => void;
  /** Open the column's full editor — title, alignment and the rest. */
  onMoreOptions?: () => void;
  onClose: () => void;
  /** The sheet, with this row as `here`, when the view shows coordinates (D34). */
  grid?: Grid;
  /**
   * Every row of the table as stored, so a formula that reads another row
   * previews, and shows that row's input, correctly. Absent: this row only.
   */
  allRows?: Row[];
  /** The other tables, so lookups and linked rows preview too (D36). */
  computeOptions?: ComputeOptions;
}

/**
 * What a formula cell is: the column's one formula, what it read in this
 * row, and what it made. A formula belongs to its column (SPEC section 2),
 * so the panel says so and offers to edit the column rather than the cell.
 */
export function FormulaCellPanel({
  field,
  row,
  fields,
  anchorRect,
  renderValue,
  onSave,
  onMoreOptions,
  onClose,
  grid,
  allRows,
  computeOptions,
}: FormulaCellPanelProps) {
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();
  const place = placePopover(anchorRect, viewportHeight);
  const left = Math.max(
    8,
    Math.min(viewportWidth - POPOVER_WIDTH - 8, anchorRect.left + anchorRect.width - POPOVER_WIDTH),
  );
  const stored = field.computed?.expr ?? "";
  const { formulaSyntax } = useDisplaySettings();
  // Edited here, from any cell, as Grist does — but it is the column's
  // formula, so saving says "every row" and every row changes.
  const [draft, setDraft] = useState(() => formulaDraftOf(field, grid, formulaSyntax));
  const explained = explainFormula({ field, row, fields, draft, editable: !!onSave, grid, allRows, computeOptions });
  const { compiled, changed, thisRow, otherRows, preview } = explained;
  const save = () => {
    if (onSave && explained.save) onSave(explained.save);
  };

  return (
    <Portal>
      <html.button onClick={onClose} style={styles.backdrop} />
      <html.div
        style={[
          styles.popover,
          place.below
            ? styles.popoverPosition(place.top, left, POPOVER_WIDTH)
            : styles.popoverAbove(place.bottom, left, POPOVER_WIDTH),
          styles.popoverMaxHeight(place.maxHeight),
        ]}
      >
        <html.div style={styles.identity}>
          <html.span>{field.title ?? field.name}</html.span>
          <html.span style={styles.typeBadge}>
            <html.span>Formula</html.span>
            <html.span style={styles.typeBadgeTechnical}>· every row</html.span>
          </html.span>
        </html.div>

        {onSave ? (
          <>
            <html.input
        dir="auto"
              type="text"
              value={draft}
              onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
              onKeyDown={(e: { key: string }) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") onClose();
              }}
              style={[styles.input, styles.formulaInput]}
            />
            <FormulaStatus result={compiled} typed={draft} />
          </>
        ) : (
          <>
            <html.span style={[styles.input, styles.formulaInput]}>{printFormula(stored, { grid, syntax: formulaSyntax })}</html.span>
            {formulaSyntax === "stored" ? null : <html.span style={styles.hintText}>Stored as {stored}</html.span>}
          </>
        )}

        {thisRow.length > 0 && (
          <>
            <html.span style={styles.label}>In this row</html.span>
            {thisRow.map((input) => (
              <html.div key={input.field} style={styles.inputRow}>
                <html.span style={styles.inputName}>{input.label}</html.span>
                <html.span>{renderValue(input.field, input.value)}</html.span>
              </html.div>
            ))}
          </>
        )}
        {otherRows.length > 0 && (
          <>
            <html.span style={styles.label}>From other rows</html.span>
            {otherRows.map((r) => (
              <html.div key={`${r.rowId}\u0000${r.field}`} style={styles.inputRow}>
                <html.span style={styles.inputName}>{r.label}</html.span>
                <html.span>{renderValue(r.field, r.value)}</html.span>
              </html.div>
            ))}
          </>
        )}
        <html.div style={[styles.inputRow, styles.resultRow]}>
          <html.span style={styles.inputName}>Result</html.span>
          <html.span>{renderValue(field.name, row[field.name])}</html.span>
        </html.div>
        {preview && (
          <html.div style={[styles.inputRow, styles.previewRow]}>
            <html.span style={styles.inputName}>After saving</html.span>
            <html.span>{renderValue(field.name, preview.value)}</html.span>
          </html.div>
        )}

        <html.span style={styles.noteText}>
          One formula for the whole column. Every row is worked out the same way.
        </html.span>

        <html.div style={styles.actionRow}>
          {onSave && (
            <html.button
              disabled={!changed}
              onClick={save}
              style={[styles.button, changed && styles.primaryButton]}
            >
              Save for every row
            </html.button>
          )}
          <html.button onClick={onClose} style={styles.button}>
            Close
          </html.button>
        </html.div>
        {onMoreOptions && (
          <html.button onClick={onMoreOptions} style={styles.linkButton}>
            More options…
          </html.button>
        )}
      </html.div>
    </Portal>
  );
}
