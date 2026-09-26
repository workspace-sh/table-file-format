import { useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import type { CompileResult, Field, FieldAlignment, FieldType, Grid, Row } from "@workspace.sh/table-core";
import type { ReactNode } from "react";
import {
  compileFormula,
  computeRows,
  currencyOf,
  inputCurrency,
  defaultAlignFor,
  enumOptions,
  enumValues,
  formulaRefs,
  coordinateOf,
  formulaType,
  parseExpr,
  printFormula,
  formatValue,
} from "@workspace.sh/table-core";
import { Portal } from "./internal/Portal";
import { useDisplaySettings } from "./DisplaySettings";
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

export function friendlyType(type: FieldType): string {
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

// ---- display formats (SPEC section 2, "Field format")

/**
 * ISO 4217 currency codes, from the platform's own Intl data so the list
 * never goes stale. Hermes and older engines lack supportedValuesOf, so a
 * short list of the commonest stands in there.
 */
function currencyCodes(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("currency");
  } catch {
    // fall through
  }
  return ["AUD", "BRL", "CAD", "CHF", "CNY", "DKK", "EUR", "GBP", "HKD", "INR", "JPY", "KRW", "MXN", "NOK", "NZD", "SEK", "SGD", "USD", "ZAR"];
}

/** "British Pound" for GBP, in the reader's own language; the code alone if the platform can't say. */
function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

type FormatFamily = "number" | "date" | "string" | null;

function formatFamily(type: FieldType): FormatFamily {
  if (type === "number" || type === "integer" || type === "year") return "number";
  if (type === "date" || type === "datetime") return "date";
  if (type === "string") return "string";
  return null;
}

/** The spec's closed vocabulary, per family. The empty value means "the default". */
const FORMAT_CHOICES: Record<Exclude<FormatFamily, null>, { value: string; label: string }[]> = {
  number: [
    { value: "", label: "Plain number" },
    { value: "integer", label: "Whole number" },
    { value: "decimal", label: "Decimal places…" },
    { value: "percent", label: "Percent" },
    { value: "currency", label: "Currency…" },
    { value: "duration:seconds", label: "Duration (seconds)" },
  ],
  date: [
    // Not set: the table leaves it to whoever shows it (the app's default).
    { value: "", label: "App's default" },
    { value: "iso", label: "ISO" },
    { value: "short", label: "Short" },
    { value: "long", label: "Long" },
    { value: "weekday", label: "With weekday" },
    { value: "relative", label: "Relative" },
  ],
  string: [
    { value: "", label: "Plain text" },
    { value: "markdown", label: "Markdown" },
    { value: "url", label: "Link" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
  ],
};

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
  const family = formatFamily(field.type);
  if (!family) return null;
  // Currency is a unit (D33): a formula shows its inputs' currency unless
  // told otherwise, and choosing another relabels without converting.
  const inherited = field.computed ? inputCurrency(field, { fields }) : undefined;
  const own = currencyOf(field);
  const title = field.title ?? field.name;
  const choices = FORMAT_CHOICES[family].map((o) =>
    o.value === "" && family === "number" && inherited
      ? {
          ...o,
          label:
            inherited === "mixed"
              ? "Plain number (inputs are in different currencies)"
              : `Same as inputs (${inherited})`,
        }
      : o,
  );
  // Date choices show what they look like, today, in the app's locale.
  const display = useDisplaySettings();
  const today = new Date().toISOString().slice(0, 10);
  const example = (token: string) =>
    formatValue({ name: "example", type: "date", format: token || display.dateFormat || "iso" }, today, display);
  const shown = family === "date" ? choices.map((o) => ({ ...o, label: `${o.label} (${example(o.value)})` })) : choices;
  const current = field.format ?? "";
  const kind = current.startsWith("decimal:") ? "decimal" : current.startsWith("currency:") ? "currency" : current;
  const digits = current.startsWith("decimal:") ? Number(current.slice("decimal:".length)) || 0 : 2;
  const code = current.startsWith("currency:") ? current.slice("currency:".length).toUpperCase() : "";
  const set = (format: string) => onUpdate({ format: format || undefined });
  const choose = (next: string) => {
    if (next === "decimal") set(`decimal:${digits}`);
    // A formula's inputs decide its unit; only a column with nothing to go
    // on falls back to the reader's own currency.
    else if (next === "currency")
      set(`currency:${code || (inherited && inherited !== "mixed" ? inherited : defaultCurrency())}`);
    else set(next);
  };
  return (
    <>
      <html.span style={styles.label}>Format</html.span>
      <html.select
        value={kind}
        onChange={(e: { target: { value: string } }) => choose(e.target.value)}
        style={styles.input}
      >
        {shown.map((o) => (
          <html.option key={o.value || "default"} value={o.value}>
            {o.label}
          </html.option>
        ))}
      </html.select>
      {kind === "decimal" && (
        <html.select
          value={String(digits)}
          onChange={(e: { target: { value: string } }) => set(`decimal:${e.target.value}`)}
          style={styles.input}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <html.option key={d} value={String(d)}>
              {d} decimal place{d === 1 ? "" : "s"}
            </html.option>
          ))}
        </html.select>
      )}
      {kind === "currency" && (
        <html.select
          value={code}
          onChange={(e: { target: { value: string } }) => set(`currency:${e.target.value}`)}
          style={styles.input}
        >
          {currencyCodes().map((c) => (
            <html.option key={c} value={c}>
              {c} · {currencyName(c)}
            </html.option>
          ))}
        </html.select>
      )}
      {own && inherited && inherited !== "mixed" && own !== inherited && (
        <html.span style={styles.warnText}>
          {title} is worked out from values in {inherited}. Showing it in {own} relabels the numbers; it
          doesn't convert them.
        </html.span>
      )}
      {own && !field.computed && (
        <html.span style={styles.noteText}>
          The currency labels these numbers. Changing it doesn't convert them. To convert, use a formula with a
          rate.
        </html.span>
      )}
    </>
  );
}

/** The reader's own currency where the platform can tell, else US dollars. */
function defaultCurrency(): string {
  try {
    const region = new Intl.Locale(Intl.NumberFormat().resolvedOptions().locale).maximize().region;
    const byRegion: Record<string, string> = { GB: "GBP", US: "USD", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", JP: "JPY", CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF", IN: "INR" };
    return (region && byRegion[region]) || "USD";
  } catch {
    return "USD";
  }
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
  // A formula is edited in Excel style and saved in the stored form (D29).
  // Only a field that is already computed shows this: turning a stored
  // field into a formula would drop its data, and schemas only grow.
  const [formulaDraft, setFormulaDraft] = useState(() =>
    field.computed ? printFormula(field.computed.expr, { grid }) : "",
  );
  const formula = field.computed
    ? compileFormula(formulaDraft, { fields: (fields ?? []).map((f) => f.name), grid })
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

        <FormatPicker field={field} fields={fields ?? []} onUpdate={onUpdate} />

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
  /** The sheet, when the view shows coordinates (D34). */
  grid?: Grid;
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

export function AddFieldButton({ existingNames, onAdd, fields, grid }: AddFieldButtonProps) {
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
      ? compileFormula(formulaDraft, { fields: [...existingNames], grid })
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
                  placeholder="=round(budget / 12, 0)"
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
}: FormulaCellPanelProps) {
  const viewportWidth = useViewportWidth();
  const viewportHeight = useViewportHeight();
  const place = placePopover(anchorRect, viewportHeight);
  const left = Math.max(
    8,
    Math.min(viewportWidth - POPOVER_WIDTH - 8, anchorRect.left + anchorRect.width - POPOVER_WIDTH),
  );
  const stored = field.computed?.expr ?? "";
  // Edited here, from any cell, as Grist does — but it is the column's
  // formula, so saving says "every row" and every row changes.
  const [draft, setDraft] = useState(() => printFormula(stored, { grid }));
  const compiled = onSave ? compileFormula(draft, { fields: fields.map((f) => f.name), grid }) : null;
  const changed = compiled?.ok === true && compiled.stored !== stored;
  const shownExpr = changed && compiled?.ok ? compiled.expr : null;
  const parsed = parseExpr(stored);
  const refs = shownExpr ? formulaRefs(shownExpr) : parsed.ok ? formulaRefs(parsed.expr) : [];
  const title = (name: string) => fields.find((f) => f.name === name)?.title ?? name;
  const rowId = String(row.id);
  // The whole table, computed, so another row's value (computed or not)
  // shows as its cell does.
  const tableRows = allRows ?? [row as Row];
  const computedAll = computeRows({ fields }, tableRows).rows;
  const valueIn = (id: string, name: string) =>
    id === rowId ? row[name] : computedAll.find((r) => r.id === id)?.[name];
  const thisRow = refs.filter((r) => r.rowId === undefined || r.rowId === rowId);
  const otherRows = refs.filter((r) => r.rowId !== undefined && r.rowId !== rowId);
  const otherLabel = (r: { field: string; rowId?: string }) =>
    (grid && coordinateOf(r.field, r.rowId!, grid)) ?? `${title(r.field)} of row ${r.rowId}`;
  // What this row would show with the draft formula — the one thing the
  // column editor can't tell you. Computed the same way the table is.
  const preview = (() => {
    if (!changed || !compiled?.ok) return undefined;
    const trial = fields.map((f) =>
      f.name === field.name ? { ...f, computed: { expr: compiled.stored, dialect: DIALECT } } : f,
    );
    const { rows } = computeRows({ fields: trial }, tableRows);
    return { value: rows.find((r) => r.id === rowId)?.[field.name] };
  })();
  const save = () => {
    if (!onSave || !changed || !compiled?.ok) return;
    const types = new Map(fields.map((f) => [f.name, f.type] as const));
    const produced = formulaType(compiled.expr, types);
    onSave({
      computed: { expr: compiled.stored, dialect: DIALECT },
      ...(typeFamily(produced) !== typeFamily(field.type) ? { type: produced } : {}),
    });
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
              type="text"
              value={draft}
              onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
              onKeyDown={(e: { key: string }) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") onClose();
              }}
              style={[styles.input, styles.formulaInput]}
            />
            <FormulaStatus result={compiled} />
          </>
        ) : (
          <>
            <html.span style={[styles.input, styles.formulaInput]}>{printFormula(stored, { grid })}</html.span>
            <html.span style={styles.hintText}>Stored as {stored}</html.span>
          </>
        )}

        {thisRow.length > 0 && (
          <>
            <html.span style={styles.label}>In this row</html.span>
            {thisRow.map(({ field: name }) => (
              <html.div key={name} style={styles.inputRow}>
                <html.span style={styles.inputName}>{title(name)}</html.span>
                <html.span>{renderValue(name, row[name])}</html.span>
              </html.div>
            ))}
          </>
        )}
        {otherRows.length > 0 && (
          <>
            <html.span style={styles.label}>From other rows</html.span>
            {otherRows.map((r) => (
              <html.div key={`${r.rowId}\u0000${r.field}`} style={styles.inputRow}>
                <html.span style={styles.inputName}>{otherLabel(r)}</html.span>
                <html.span>{renderValue(r.field, valueIn(r.rowId!, r.field))}</html.span>
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
