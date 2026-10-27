// Development only: table-app's TableEmbed as a document would show it,
// over real `.table` folders on the phone, read through expo-file-system,
// one embed for each case a document can hold. Shown over the app by the
// development hook (`__tableMobile.embedTest(folder)`); never in a release.

import { useEffect, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { css, html } from "react-strict-dom";
import { embedFilesWith, readEmbedWith, type EmbedRead } from "@workspace.sh/table-app";
import { TableEmbed } from "@workspace.sh/table-app/embed-view";
import { expoFs } from "./expoFs";

// What a document in <folder>/docs could link to, and what each should show.
const CASES: { address: string; caption?: string; note: string }[] = [
  { address: "../projects.table#table=tasks&view=All%20tasks%20by%20priority&embed=1", caption: "All tasks", note: "a table's view" },
  { address: "../projects.table#table=tasks&view=juycicwios88m&embed=1", caption: "All tasks", note: "the same view by its id: a link may name a view either way" },
  { address: "../projects.table#table=tasks&rows=3&embed=1", caption: "Three rows, then it scrolls", note: "rows=3" },
  { address: "../projects.table#table=tasks&rows=3&rest=more&embed=1", note: "rows=3, the rest behind a line" },
  { address: "../crm.table#table=deals&cards=1&rest=more&embed=1", note: "a board, one card a column, the rest behind a line" },
  { address: "../crm.table#table=deals&embed=1", note: "the CRM's deals" },
  { address: "../projects.table#table=projects&embed=1", note: "the projects, taller than the limit" },
  { address: "../nowhere.table#embed=1", caption: "Missing", note: "no such file" },
  { address: "../projects.table#table=nope&embed=1", note: "no such table" },
  { address: "../../elsewhere/projects.table#embed=1", note: "outside the folder" },
];

export function EmbedTest({ folder, onClose }: { folder: string; onClose: () => void }) {
  const [reads, setReads] = useState<(EmbedRead | null)[]>(() => CASES.map(() => null));
  useEffect(() => {
    let current = true;
    void Promise.all(CASES.map((c) => readEmbedWith(expoFs, { address: c.address, baseDir: `${folder}/docs`, within: folder }))).then(
      (all) => current && setReads(all),
    );
    return () => {
      current = false;
    };
  }, [folder]);
  const files = useMemo(() => embedFilesWith(expoFs), []);
  return (
    <html.div style={styles.over}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
        <html.div style={styles.head}>
          <html.span style={styles.heading}>Table embeds</html.span>
          <html.button onClick={onClose}>Close</html.button>
        </html.div>
        {CASES.map((c, i) => (
          <html.div key={c.address} style={styles.case}>
            <html.span style={styles.note}>
              {c.note} · {c.address}
            </html.span>
            <TableEmbed read={reads[i] ?? null} files={files} {...(c.caption ? { caption: c.caption } : {})} />
          </html.div>
        ))}
      </ScrollView>
    </html.div>
  );
}

const styles = css.create({
  over: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1e" },
  },
  head: { display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 22, fontWeight: "700", color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" } },
  case: { display: "flex", flexDirection: "column", gap: 8 },
  note: { fontSize: 12, color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" } },
});
