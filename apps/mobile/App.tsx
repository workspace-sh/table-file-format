import { html, css } from "react-strict-dom";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
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
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
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
    flexDirection: "column",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
});

export default function App() {
  const table: ParsedTable = fixture;
  const view: View = table.views[0]!;
  const rows = applyView(table, view);
  const errors = validate(table.schema, table.rows);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }}>
        <html.div style={styles.root}>
          <html.div style={styles.scroll}>
            <html.span style={styles.title}>{table.meta.title ?? "Untitled"}</html.span>
            <html.span style={styles.subtitle}>
              {rows.length} of {table.rows.length} rows · {errors.length === 0
                ? "schema valid"
                : `${errors.length} validation issues`}
            </html.span>
            {rows.map((row) => (
              <html.div key={row.id} style={styles.row}>
                <html.span style={styles.rowTitle}>
                  {String(row[table.schema.fields[0]!.name] ?? row.id)}
                </html.span>
                <html.span style={styles.rowMeta}>
                  {table.schema.fields
                    .slice(1, 3)
                    .map((f) => `${f.name}: ${row[f.name] ?? "—"}`)
                    .join(" · ")}
                </html.span>
              </html.div>
            ))}
          </html.div>
        </html.div>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
