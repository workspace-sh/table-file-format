// What a column is, as facts, whatever shows them: the web's rich hover
// hint (FieldHint), and the plain-text tooltips of macOS and GTK
// (fieldHintText). Everything is in the schema already (SPEC section 2:
// `description` is the field's hover-help); this only gathers it.

import { effectiveFormat, printFormula } from "@workspace.sh/table-core";
import type { Field, TableSchema } from "@workspace.sh/table-core";

import { friendlyType } from "./fieldEdit";

export interface FieldHintFacts {
  title: string;
  /** Its kind, then Required, Choice list, what it links to, its format, Deprecated. */
  facts: string[];
  description?: string;
  /** Its formula, as the reader types formulas. */
  formula?: string;
  /** The stored key, when the title differs from it. */
  storedAs?: string;
  /** Said when clicking the header opens its editor. */
  editHint?: string;
}

const FORMAT_WORDS: Record<string, string> = {
  iso: "ISO date",
  short: "Short date",
  long: "Long date",
  weekday: "Weekday",
  relative: "Relative date",
  integer: "Whole number",
  percent: "Percent",
  "duration:seconds": "Duration",
  markdown: "Markdown",
  url: "Link",
  email: "Email",
  phone: "Phone",
};

function formatWords(format: string): string {
  if (format.startsWith("currency:")) return `Currency (${format.slice("currency:".length)})`;
  if (format.startsWith("decimal:")) return `${format.slice("decimal:".length)} decimal places`;
  return FORMAT_WORDS[format] ?? format;
}

/** The hint for one column. `editable`: the header opens its editor when clicked. */
export function fieldHint(options: {
  field: Field | undefined;
  name: string;
  schema: TableSchema;
  editable: boolean;
  formulaSyntax?: "excel" | "stored";
}): FieldHintFacts {
  const { field, name, schema, editable, formulaSyntax } = options;
  const title = field?.title ?? name;
  const kind = field?.computed ? "Formula" : field ? friendlyType(field.type) : "Unknown field";
  const format = field ? effectiveFormat(field, schema) : undefined;
  const facts: string[] = [kind];
  if (field?.constraints?.required) facts.push("Required");
  if (field?.constraints?.enum) facts.push("Choice list");
  if (field?.relation) facts.push(`Links to ${field.relation.table}`);
  if (format) facts.push(formatWords(format));
  if (field?.deprecated) facts.push("Deprecated");
  return {
    title,
    facts,
    ...(field?.description ? { description: field.description } : {}),
    ...(field?.computed?.expr ? { formula: printFormula(field.computed.expr, { syntax: formulaSyntax }) } : {}),
    ...(title !== name ? { storedAs: `Stored as “${name}”` } : {}),
    ...(editable ? { editHint: "Click to edit this column" } : {}),
  };
}

/** The hint as plain text, a line each, for a platform whose tooltips take text. */
export function fieldHintText(hint: FieldHintFacts): string {
  return [hint.title, hint.facts.join(" · "), hint.description, hint.formula, hint.storedAs, hint.editHint].filter(Boolean).join("\n");
}
