import { html, css } from "react-strict-dom";
import { applyView, validate } from "@workspace/table-core";
import type { ParsedTable, View } from "@workspace/table-core";
import { fixture } from "./src/fixture";

const styles = css.create({
  root: {
    flex: 1,
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#0e0e10",
    },
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 4,
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  subtitle: {
    fontSize: 12,
    marginBottom: 16,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  row: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  cell: {
    flex: 1,
    fontSize: 13,
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
});

export default function App() {
  const table: ParsedTable = fixture;
  const view: View = table.views[0]!;
  const rows = applyView(table, view);
  const errors = validate(table.schema, table.rows);
  const fields = view.fields ?? table.schema.fields.map((f) => f.name);

  return (
    <html.div style={styles.root}>
      <html.div style={styles.content}>
        <html.span style={styles.title}>{table.meta.title ?? "Untitled"}</html.span>
        <html.span style={styles.subtitle}>
          {rows.length} of {table.rows.length} rows ·{" "}
          {errors.length === 0
            ? "schema valid"
            : `${errors.length} validation issues`}
        </html.span>
        {rows.map((row) => (
          <html.div key={row.id} style={styles.row}>
            {fields.map((name) => (
              <html.span key={name} style={styles.cell}>
                {String(row[name] ?? "—")}
              </html.span>
            ))}
          </html.div>
        ))}
      </html.div>
    </html.div>
  );
}
