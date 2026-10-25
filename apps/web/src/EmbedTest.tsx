// Development only (`#embed-test`): table-app's TableEmbed as a document
// would show it, over the example tables written into a folder in memory,
// one embed for each case a document can hold. Not in a production build.

import { useEffect, useMemo, useState } from "react";
import { css, html } from "react-strict-dom";
import { memoryFs, writeBundleTo } from "@workspace.sh/table-core/io";
import { embedFilesWith, readEmbedWith, toBundle, type EmbedRead } from "@workspace.sh/table-app";
import { TableEmbed } from "@workspace.sh/table-app/embed-view";
import { bundles, tables } from "./loadFixture";

// What a document in /ws/docs could link to, and what each should show.
const CASES: { address: string; caption?: string; note: string }[] = [
  { address: "../tables/projects.table#table=tasks&view=ffaisc1zows4dzhy7aq5jrebkx&embed=1", caption: "All tasks", note: "a table's view" },
  { address: "../tables/projects.table#table=tasks&rows=3&embed=1", caption: "Three rows, then it scrolls", note: "rows=3" },
  { address: "../tables/projects.table#table=tasks&rows=3&rest=more&embed=1", note: "rows=3, the rest behind a line" },
  { address: "../tables/crm.table#table=deals&cards=1&rest=more&embed=1", note: "a board, one card a column, the rest behind a line" },
  { address: "../tables/crm.table#table=deals&view=9gcz9d8ctoqamitkgwfhiu7sru&rows=2&rest=more&embed=1", note: "two deals of eight; the totals beneath are of all eight" },
  { address: "../tables/projects.table#table=tasks&view=gzrqtgo1p3gfehto7tani3jzz4&cards=1&rest=more&embed=1", note: "a board one card deep; each column says how many it has, and how many more" },
  { address: "../tables/projects.table#table=projects&view=r1mmz6bdngh1qjdyc7a3u3n58c&rows=3&rest=more&embed=1", note: "a grouped table cut inside its first group; the group's count is of all its rows" },
  { address: "../tables/projects.table#table=projects&view=u5fpdkwh5w9thdq8o368a9t4nw&rows=4&rest=more&embed=1", note: "a list of four" },
  { address: "../tables/projects.table#table=projects&view=yxqsjf1fmbakwepxpx4ta44xks&cards=2&rest=more&embed=1", note: "a gallery of two cards" },
  { address: "../tables/crm.table#table=deals&embed=1", note: "the CRM's deals" },
  { address: "../tables/projects.table#table=projects&embed=1", note: "a large page-heavy table" },
  { address: "../tables/nowhere.table#embed=1", caption: "Missing", note: "no such file" },
  { address: "../tables/projects.table#table=nope&embed=1", note: "no such table" },
  { address: "../tables/projects.table#table=tasks&view=nope&embed=1", note: "no such view" },
  { address: "../../elsewhere/projects.table#embed=1", note: "outside the folder" },
];

export function EmbedTest() {
  const fs = useMemo(() => memoryFs(), []);
  // Written once, however many times React runs the effect (twice in development).
  const ready = useMemo(
    () =>
      (async () => {
        for (const key of Object.keys(bundles)) await writeBundleTo(fs, `/ws/tables/${key}.table`, toBundle(tables, bundles, key));
      })(),
    [fs],
  );
  const [reads, setReads] = useState<(EmbedRead | null)[]>(() => CASES.map(() => null));
  useEffect(() => {
    let current = true;
    void ready
      .then(() => Promise.all(CASES.map((c) => readEmbedWith(fs, { address: c.address, baseDir: "/ws/docs", within: "/ws" }))))
      .then((all) => current && setReads(all));
    return () => {
      current = false;
    };
  }, [fs, ready]);
  const files = useMemo(() => embedFilesWith(fs), [fs]);
  // Written back as it's edited: what's in the folder for each file, to look at.
  const [written, setWritten] = useState("");
  return (
    <html.div style={styles.page}>
      <html.h1 style={styles.heading}>Table embeds</html.h1>
      <html.p style={styles.lede}>table-app's TableEmbed over the example tables, written into a folder in memory, as a document in /ws/docs would show them.</html.p>
      {CASES.map((c, i) => (
        <html.section key={c.address} style={styles.case}>
          <html.p style={styles.note}>
            {c.note} · <html.code>{c.address}</html.code>
          </html.p>
          <TableEmbed read={reads[i] ?? null} files={files} {...(c.caption ? { caption: c.caption } : {})} />
        </html.section>
      ))}
      <html.button
        style={styles.button}
        onClick={() => void fs.readText("/ws/tables/projects.table/tables/tasks/rows/0001.ndjson").then((t) => setWritten(t ?? ""))}
      >
        Show projects.table/tables/tasks/rows/0001.ndjson as written
      </html.button>
      {written ? <html.pre style={styles.pre}>{written}</html.pre> : null}
    </html.div>
  );
}

const styles = css.create({
  page: { maxWidth: 960, marginInline: "auto", paddingBlock: 32, paddingInline: 16, display: "flex", flexDirection: "column", gap: 24 },
  heading: { fontSize: 24, margin: 0 },
  lede: { margin: 0, opacity: 0.7 },
  case: { display: "flex", flexDirection: "column", gap: 8 },
  note: { margin: 0, fontSize: 13, opacity: 0.7 },
  button: { alignSelf: "flex-start", paddingBlock: 6, paddingInline: 12 },
  pre: { fontSize: 11, overflowX: "auto", whiteSpace: "pre" },
});
