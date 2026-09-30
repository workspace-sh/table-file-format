// Editing a cell, whatever draws the editor: which editor a field gets,
// the text an edit starts from, and what saving a draft does (D42). The
// web views and table-gtk both run these, so a value is refused, asked
// about or saved the same way on every platform.

import { enumOptions, type Field, type ParsedTable } from "@workspace.sh/table-core";

import { checkEntry, type CellCheck } from "./cellCheck";
import { relationLabel } from "./display";

/**
 * The editor a field gets. A computed field is derived on read and never
 * stored, so there's nothing to edit; a relation is picked, not typed.
 */
export type EditorKind = "readonly" | "boolean" | "list" | "choice" | "relation" | "text";

export function editorKind(field: Field | undefined): EditorKind {
  if (field?.computed !== undefined) return "readonly";
  if (field?.type === "boolean") return "boolean";
  if (field?.relation) return "relation";
  if (field?.type === "array" && !field.relation) return "list";
  if (enumOptions(field).length > 0) return "choice";
  return "text";
}

/** The kind of text input a field is typed in (the HTML input types; other toolkits map them). */
export type InputKind = "number" | "date" | "datetime-local" | "time" | "text";

export function inputKind(field: Field | undefined): InputKind {
  switch (field?.type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "time":
      return "time";
    default:
      return "text";
  }
}

/** The text an edit starts from: the stored value, or nothing. */
export function draftOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * A currency field's symbol, shown beside its input so it's clear what the
 * number is in; the stored value is a plain number. Null for an unknown
 * ISO 4217 code or a field without a currency format.
 */
export function currencySymbolOf(field: Field | undefined, locale?: string): string | null {
  const format = field?.format;
  if (!format?.startsWith("currency:")) return null;
  try {
    const parts = new Intl.NumberFormat(locale, { style: "currency", currency: format.slice("currency:".length) }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? null;
  } catch {
    return null;
  }
}

/** What saving a draft comes to. */
export type Commit =
  /** Saved: the value changed. */
  | { kind: "save"; value: unknown }
  /** Nothing to save: the draft is what's stored. The editor closes. */
  | { kind: "unchanged" }
  /**
   * Not saved: the editor stays open with the reason. When `confirmable`,
   * the same draft saved again is kept (an early year, D42): `queried`
   * is the draft to pass back as `queried` next time.
   */
  | { kind: "problem"; check: CellCheck & { ok: false }; queried: string | null }
  /** Left by moving away with a draft the column can't hold: dropped, as there's no one to ask. */
  | { kind: "dropped" };

/**
 * Save `raw` into a cell holding `current`, from a key (Enter, Tab) or by
 * leaving the editor (`blur`). `queried` is the draft already asked about.
 * An early year is kept on leaving, being a valid date.
 */
export function commitDraft(
  field: Field | undefined,
  current: unknown,
  raw: string,
  how: "key" | "blur",
  queried: string | null,
): Commit {
  const check = checkEntry(field, raw, queried === raw || how === "blur");
  if (!check.ok) {
    if (how === "blur") return { kind: "dropped" };
    return { kind: "problem", check, queried: check.confirmable ? raw : queried };
  }
  return check.value !== current ? { kind: "save", value: check.value } : { kind: "unchanged" };
}

// ─── Lists ─────────────────────────────────────────────────────────────

/** A list cell's items, as text. */
export function listItems(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** A plain list as it's typed: "a, b, c". */
export function listText(value: unknown): string {
  return listItems(value).join(", ");
}

/** Typed "a, b, c" as the list it stores; nothing typed is no value. */
export function listFromText(text: string): string[] | undefined {
  const next = text.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  return next.length ? next : undefined;
}

/**
 * A multi-select's value with `choice` toggled, in the choice list's order,
 * so the same set is always written the same way. None left is no value.
 */
export function listToggled(field: Field | undefined, value: unknown, choice: string): string[] | undefined {
  const items = listItems(value);
  const next = items.includes(choice) ? items.filter((i) => i !== choice) : [...items, choice];
  const ordered = enumOptions(field).map((o) => o.value).filter((v) => next.includes(v));
  return ordered.length ? ordered : undefined;
}

// ─── Relations ─────────────────────────────────────────────────────────

/** Whether a relation holds many rows (an array of ids) rather than one. */
export function relatesMany(field: Field | undefined): boolean {
  return field?.relation?.cardinality === "many" || (field?.type === "array" && !!field?.relation);
}

/**
 * The rows a relation cell can point at, in the related table's order,
 * each labelled as a relation cell shows it (relationLabel). Empty when
 * the related table isn't loaded.
 */
export function relationOptions(field: Field | undefined, relatedTables: Record<string, ParsedTable> | undefined): { value: string; label: string }[] {
  const relation = field?.relation;
  const target = relation ? relatedTables?.[relation.table] : undefined;
  if (!relation || !target) return [];
  return target.rows.map((r) => ({ value: r.id, label: relationLabel(relation, r.id, relatedTables) ?? r.id }));
}

/**
 * A many-relation's value with row `id` added or taken away, kept in the
 * related table's order so the same set is always written the same way.
 * None left is no value.
 */
export function relationToggled(field: Field | undefined, value: unknown, id: string, relatedTables: Record<string, ParsedTable> | undefined): string[] | undefined {
  const items = listItems(value);
  const next = items.includes(id) ? items.filter((i) => i !== id) : [...items, id];
  const order = relationOptions(field, relatedTables).map((o) => o.value);
  // Ids the related table doesn't have (dangling) stay, after the rest.
  const ordered = [...order.filter((v) => next.includes(v)), ...next.filter((v) => !order.includes(v))];
  return ordered.length ? ordered : undefined;
}
