// What a column is, shown when the pointer rests on its header: the kind
// of hint Notion and Superhuman give. Everything here is in the schema
// already (SPEC section 2: `description` is the field's hover-help); this
// only gathers it where people look.

import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";
import { effectiveFormat, printFormula } from "@workspace.sh/table-core";
import type { Field, TableSchema } from "@workspace.sh/table-core";

import { useDisplaySettings } from "./DisplaySettings";
import { friendlyType } from "./SchemaEditor";
import { useHoverHint } from "./internal/useHoverHint";

/** A span that shows `hint` when the pointer rests on it (web only). */
export function Hinted({
  hint,
  style,
  children,
}: {
  hint: ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
  children: ReactNode;
}) {
  const { props, element } = useHoverHint(hint);
  // Centres what it wraps, so a badge or button inside a row keeps the
  // alignment it had without the wrapper.
  return (
    <html.span {...props} style={[styles.hinted, style]}>
      {children}
      {element}
    </html.span>
  );
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
export function FieldHint({
  field,
  name,
  schema,
  editable,
}: {
  field: Field | undefined;
  name: string;
  schema: TableSchema;
  editable: boolean;
}) {
  const title = field?.title ?? name;
  const kind = field?.computed ? "Formula" : field ? friendlyType(field.type) : "Unknown field";
  const format = field ? effectiveFormat(field, schema) : undefined;
  const facts: string[] = [kind];
  if (field?.constraints?.required) facts.push("Required");
  if (field?.constraints?.enum) facts.push("Choice list");
  if (field?.relation) facts.push(`Links to ${field.relation.table}`);
  if (format) facts.push(formatWords(format));
  if (field?.deprecated) facts.push("Deprecated");
  const { formulaSyntax } = useDisplaySettings();
  const formula = field?.computed?.expr ? printFormula(field.computed.expr, { syntax: formulaSyntax }) : null;
  return (
    <html.div style={styles.stack}>
      <html.span style={styles.title}>{title}</html.span>
      <html.span style={styles.facts}>{facts.join(" · ")}</html.span>
      {field?.description ? <html.span style={styles.description}>{field.description}</html.span> : null}
      {formula ? <html.span style={styles.formula}>{formula}</html.span> : null}
      {title !== name ? <html.span style={styles.muted}>Stored as “{name}”</html.span> : null}
      {editable ? <html.span style={styles.muted}>Click to edit this column</html.span> : null}
    </html.div>
  );
}

const styles = css.create({
  hinted: { display: "inline-flex", alignItems: "center" },
  stack: { display: "flex", flexDirection: "column", gap: 4 },
  title: { fontSize: 13, fontWeight: "600" },
  facts: {
    fontSize: 11,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#a1a1a8" },
  },
  description: { fontSize: 12 },
  formula: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    paddingInline: 6,
    paddingBlock: 3,
    borderRadius: 4,
    backgroundColor: { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#2a2a2e" },
  },
  muted: {
    fontSize: 11,
    color: { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#7c7c85" },
  },
});
