// Editing a field and adding one, whatever draws the editor: what a type
// and an alignment are called, how a field's values can be shown (its
// `format`, SPEC section 2, "Field format"), what saving a field's formula
// stores, and the field a name and type become. The web field editor and
// table-gtk's both run these.

import {
  compileFormula,
  currencyOf,
  enumValues,
  formatValue,
  formulaType,
  inputCurrency,
  type CompileResult,
  type DisplayOptions,
  type Field,
  type FieldAlignment,
  type FieldType,
  type Grid,
} from "@workspace.sh/table-core";

import { fieldKey } from "./fieldKey";
import { FORMULA_DIALECT, typeFamily } from "./formulaCell";

/**
 * What each stored type is called on screen. The type names in the file
 * (string, integer and so on) stay as they are; these are only labels.
 */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
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

/**
 * An alignment as people say it: the file stores `start` and `end` (D40),
 * which are Left and Right in a left-to-right layout and the other way
 * round in a right-to-left one.
 */
export function alignLabel(align: FieldAlignment, rtl: boolean): string {
  if (align === "center") return "Center";
  return (align === "start") !== rtl ? "Left" : "Right";
}

/** The alignments a field can be given; "auto" is none, the type's own. */
export const ALIGN_CHOICES = ["auto", "start", "center", "end"] as const;

/** A field's alignment set, or cleared back to its type's with "auto". */
export function alignPatch(choice: (typeof ALIGN_CHOICES)[number]): Partial<Field> {
  return { align: choice === "auto" ? undefined : choice };
}

// ─── Display formats ───────────────────────────────────────────────────

export type FormatFamily = "number" | "date" | "string" | null;

/** Which formats a type can take: numbers, dates or text. Null for none. */
export function formatFamily(type: FieldType): FormatFamily {
  if (type === "number" || type === "integer" || type === "year") return "number";
  if (type === "date" || type === "datetime") return "date";
  if (type === "string") return "string";
  return null;
}

/** The spec's closed vocabulary, per family. The empty value means "the default". */
export const FORMAT_CHOICES: Record<Exclude<FormatFamily, null>, { value: string; label: string }[]> = {
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
 * ISO 4217 currency codes, from the platform's own Intl data so the list
 * never goes stale. Hermes and older engines lack supportedValuesOf, so a
 * short list of the commonest stands in there.
 */
export function currencyCodes(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("currency");
  } catch {
    // fall through
  }
  return ["AUD", "BRL", "CAD", "CHF", "CNY", "DKK", "EUR", "GBP", "HKD", "INR", "JPY", "KRW", "MXN", "NOK", "NZD", "SEK", "SGD", "USD", "ZAR"];
}

/** "British Pound" for GBP, in the reader's own language; the code alone if the platform can't say. */
export function currencyName(code: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The reader's own currency where the platform can tell, else US dollars. */
export function defaultCurrency(): string {
  try {
    const region = new Intl.Locale(Intl.NumberFormat().resolvedOptions().locale).maximize().region;
    const byRegion: Record<string, string> = { GB: "GBP", US: "USD", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", JP: "JPY", CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF", IN: "INR" };
    return (region && byRegion[region]) || "USD";
  } catch {
    return "USD";
  }
}

/** A field's format as a picker shows it: the family's choices, and what's chosen. */
export interface FormatState {
  family: Exclude<FormatFamily, null>;
  /** The choices, with their labels as shown (a formula's inherited currency, a date's example). */
  choices: { value: string; label: string }[];
  /** The chosen choice: "decimal" and "currency" stand for any decimal:N and currency:XYZ. */
  kind: string;
  digits: number;
  /** The currency code, when the kind is currency. */
  code: string;
  /**
   * Notes to show under the picker, about currency being a label, not a
   * conversion (D33): a `warn` when a formula is shown in a currency other
   * than its inputs', a `note` on any column with its own currency.
   */
  notes: { kind: "warn" | "note"; text: string }[];
  /** The format a choice becomes: decimal keeps its digits, currency its code or the inputs'. */
  choose(next: string): Partial<Field>;
  decimal(digits: number): Partial<Field>;
  currency(code: string): Partial<Field>;
}

/**
 * How `field` can be shown, and what each choice sets. Null for a type
 * with no formats. `fields` lets a formula show its inputs' currency;
 * `display` gives dates their example, today, as this reader sees them.
 */
export function formatState(field: Field, fields: Field[], display: DisplayOptions & { dateFormat?: string }, today = new Date()): FormatState | null {
  const family = formatFamily(field.type);
  if (!family) return null;
  // Currency is a unit (D33): a formula shows its inputs' currency unless
  // told otherwise, and choosing another relabels without converting.
  const inherited = field.computed ? inputCurrency(field, { fields }) : undefined;
  const own = currencyOf(field);
  const title = field.title ?? field.name;
  const day = today.toISOString().slice(0, 10);
  const example = (token: string) => formatValue({ name: "example", type: "date", format: token || display.dateFormat || "iso" }, day, display);
  const choices = FORMAT_CHOICES[family]
    .map((o) =>
      o.value === "" && family === "number" && inherited
        ? { ...o, label: inherited === "mixed" ? "Plain number (inputs are in different currencies)" : `Same as inputs (${inherited})` }
        : o,
    )
    .map((o) => (family === "date" ? { ...o, label: `${o.label} (${example(o.value)})` } : o));
  const current = field.format ?? "";
  const kind = current.startsWith("decimal:") ? "decimal" : current.startsWith("currency:") ? "currency" : current;
  const digits = current.startsWith("decimal:") ? Number(current.slice("decimal:".length)) || 0 : 2;
  const code = current.startsWith("currency:") ? current.slice("currency:".length).toUpperCase() : "";
  const set = (format: string): Partial<Field> => ({ format: format || undefined });
  const notes: FormatState["notes"] = [];
  if (own && inherited && inherited !== "mixed" && own !== inherited) {
    notes.push({ kind: "warn", text: `${title} is worked out from values in ${inherited}. Showing it in ${own} relabels the numbers; it doesn't convert them.` });
  }
  if (own && !field.computed) {
    notes.push({ kind: "note", text: "The currency labels these numbers. Changing it doesn't convert them. To convert, use a formula with a rate." });
  }
  return {
    family,
    choices,
    kind,
    digits,
    code,
    notes,
    choose(next) {
      if (next === "decimal") return set(`decimal:${digits}`);
      // A formula's inputs decide its unit; only a column with nothing to
      // go on falls back to the reader's own currency.
      if (next === "currency") return set(`currency:${code || (inherited && inherited !== "mixed" ? inherited : defaultCurrency())}`);
      return set(next);
    },
    decimal: (d) => set(`decimal:${d}`),
    currency: (c) => set(`currency:${c}`),
  };
}

// ─── Constraints and choices ───────────────────────────────────────────

/** Required set or cleared; the constraints object goes when nothing's left in it. */
export function requiredPatch(field: Field, required: boolean): Partial<Field> {
  const c = { ...(field.constraints ?? {}) };
  if (required) c.required = true;
  else delete c.required;
  return { constraints: Object.keys(c).length ? c : undefined };
}

/** Whether a field takes a list of choices: a choice field, or a plain list. */
export function takesChoices(field: Field): boolean {
  return Array.isArray(field.constraints?.enum) || (field.type === "array" && !field.relation);
}

/** A typed choice, trimmed, if it's new to the field; null when empty or already there. */
export function newChoice(field: Field, typed: string): string | null {
  const value = typed.trim();
  if (!value || enumValues(field).includes(value)) return null;
  return value;
}

// ─── Formulas ──────────────────────────────────────────────────────────

/**
 * A field's formula, as typed in its editor: what it compiles to, and
 * what saving stores (with a new type when the formula's family changes).
 * `save` is absent when it doesn't compile or is what's stored already.
 */
export function fieldFormula(field: Field, fields: Field[], draft: string, grid?: Grid): { compiled: CompileResult; save?: Partial<Field> } {
  const compiled = compileFormula(draft, { fields: fields.map((f) => f.name), grid });
  if (!compiled.ok || compiled.stored === field.computed?.expr) return { compiled };
  const produced = formulaType(compiled.expr, new Map(fields.map((f) => [f.name, f.type] as const)));
  return {
    compiled,
    save: {
      computed: { expr: compiled.stored, dialect: FORMULA_DIALECT },
      ...(typeFamily(produced) !== typeFamily(field.type) ? { type: produced } : {}),
    },
  };
}

// ─── New fields ────────────────────────────────────────────────────────

/** "Formula" sits beside the stored types in the picker; it isn't one. */
export type AddableChoice = FieldType | "formula";

/** The types a new field can be, in the picker's order. */
export const ADDABLE_TYPES: FieldType[] = ["string", "integer", "number", "boolean", "date", "datetime"];

export function addableChoices(): { value: AddableChoice; label: string }[] {
  return [...ADDABLE_TYPES.map((t) => ({ value: t as AddableChoice, label: friendlyType(t) })), { value: "formula", label: "Formula" }];
}

/**
 * The field a name, a type and (for a formula) a formula make. What's
 * typed is the field's title; its stored key is made from it, never
 * clashing (`fieldKey`). A formula field can only be made once its formula
 * compiles: nothing that can't be stored canonically is written (D29).
 */
export function newField(options: {
  name: string;
  type: AddableChoice;
  formula?: string;
  existing: Set<string>;
  fields: Field[];
  grid?: Grid;
}): { key: string; compiled: CompileResult | null; field: Field | null } {
  const trimmed = options.name.trim();
  const key = fieldKey(trimmed, options.existing);
  const draft = options.formula ?? "";
  const compiled = options.type === "formula" && draft.trim() !== "" ? compileFormula(draft, { fields: [...options.existing], grid: options.grid }) : null;
  if (trimmed.length === 0) return { key, compiled, field: null };
  const title = key === trimmed ? {} : { title: trimmed };
  if (options.type !== "formula") return { key, compiled, field: { name: key, ...title, type: options.type } };
  if (!compiled?.ok) return { key, compiled, field: null };
  const types = new Map(options.fields.map((f) => [f.name, f.type] as const));
  return {
    key,
    compiled,
    field: { name: key, ...title, type: formulaType(compiled.expr, types), computed: { expr: compiled.stored, dialect: FORMULA_DIALECT } },
  };
}
