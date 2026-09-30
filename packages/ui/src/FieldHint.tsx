// What a column is, shown when the pointer rests on its header: the kind
// of hint Notion and Superhuman give. Everything here is in the schema
// already (SPEC section 2: `description` is the field's hover-help); this
// only gathers it where people look.

import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";
import type { Field, TableSchema } from "@workspace.sh/table-core";

import { useDisplaySettings } from "./DisplaySettings";
import { fieldHint } from "./fieldHint";
import { Tooltip } from "./internal/Tooltip";
import { useHoverHint } from "./internal/useHoverHint";

/**
 * A span that shows `hint` when the pointer rests on it: the web's own
 * hover hint, and on macOS the system tooltip when the hint is plain text.
 */
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
    <Tooltip text={typeof hint === "string" ? hint : undefined}>
      <html.span {...props} style={[styles.hinted, style]}>
        {children}
        {element}
      </html.span>
    </Tooltip>
  );
}

/** The hint for one column (fieldHint's facts), laid out. `editable`: the header opens its editor when clicked. */
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
  const { formulaSyntax } = useDisplaySettings();
  const hint = fieldHint({ field, name, schema, editable, formulaSyntax });
  return (
    <html.div style={styles.stack}>
      <html.span style={styles.title}>{hint.title}</html.span>
      <html.span style={styles.facts}>{hint.facts.join(" · ")}</html.span>
      {hint.description ? <html.span style={styles.description}>{hint.description}</html.span> : null}
      {hint.formula ? <html.span style={styles.formula}>{hint.formula}</html.span> : null}
      {hint.storedAs ? <html.span style={styles.muted}>{hint.storedAs}</html.span> : null}
      {hint.editHint ? <html.span style={styles.muted}>{hint.editHint}</html.span> : null}
    </html.div>
  );
}

const styles = css.create({
  hinted: { display: "flex", alignItems: "center" },
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
