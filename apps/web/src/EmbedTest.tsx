// Development only (`#embed-test`): table-app's TableEmbed as a document
// would show it, over the example tables written into a folder in memory,
// one embed for each case a document can hold. Not in a production build.

import { useEffect, useMemo, useState } from "react";
import { css, html } from "react-strict-dom";
import { parseAddress } from "@workspace.sh/table-core";
import { memoryFs, writeBundleTo } from "@workspace.sh/table-core/io";
import { bundleToArchive, embedFilesWith, embedIn, fromBundle, readEmbedWith, toBundle, type EmbedRead, type Library } from "@workspace.sh/table-app";
import { openArchiveInWorker, openWebDatabase } from "./sqlite/client";
import { TableEmbed, type EmbedIndex } from "@workspace.sh/table-app/embed-view";
import { bundles, tables } from "./loadFixture";

// What a document in /ws/docs could link to, and what each should show.
const CASES: { address: string; caption?: string; note: string }[] = [
  { address: "../tables/projects.table#table=tasks&view=All%20tasks%20by%20priority&embed=1", caption: "All tasks", note: "a table's view" },
  { address: "../tables/projects.table#table=tasks&view=juycicwios88m&embed=1", caption: "All tasks", note: "the same view by its id: a link may name a view either way" },
  { address: "../tables/projects.table#table=tasks&rows=3&embed=1", caption: "Three rows, then it scrolls", note: "rows=3" },
  { address: "../tables/projects.table#table=tasks&rows=3&rest=more&embed=1", note: "rows=3, the rest behind a line" },
  { address: "../tables/crm.table#table=deals&cards=1&rest=more&embed=1", note: "a board, one card a column, the rest behind a line" },
  { address: "../tables/crm.table#table=deals&view=All%20deals&rows=2&rest=more&embed=1", note: "two deals of eight; the totals beneath are of all eight" },
  { address: "../tables/projects.table#table=tasks&view=Board%20by%20status&cards=1&rest=more&embed=1", note: "a board one card deep; each column says how many it has, and how many more" },
  { address: "../tables/projects.table#table=projects&view=By%20owner&rows=3&rest=more&embed=1", note: "a grouped table cut inside its first group; the group's count is of all its rows" },
  { address: "../tables/projects.table#table=projects&view=Quick%20list&rows=4&rest=more&embed=1", note: "a list of four" },
  { address: "../tables/projects.table#table=projects&view=Gallery&cards=2&rest=more&embed=1", note: "a gallery of two cards" },
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
      <LargeCase />
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

// A large table (SPEC section 8) in a single file: read into the page's index
// in its worker, as the web opens one, and drawn from there, never all in memory.
const LARGE_ROWS = 50_000;
const LARGE_ADDRESS = "big.table#table=tasks&view=juycicwios88m&rows=5&rest=more&embed=1";

function LargeCase() {
  const [shown, setShown] = useState<{ read: EmbedRead; index: EmbedIndex } | null>(null);
  useEffect(() => {
    void (async () => {
      const bundle = toBundle(tables, bundles, "projects");
      const tasks = bundle.tables.tasks!;
      const rows = Array.from({ length: LARGE_ROWS }, (_, i) => ({ id: `b${i}`, title: `Big ${i}`, priority: i }));
      const bytes = await bundleToArchive("big", { ...bundle, tables: { tasks: { ...tasks, rows } } });
      const { opened, first } = await openArchiveInWorker(bytes, []);
      const library: Library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
      const keyed = Object.fromEntries(Object.entries(first).map(([t, r]) => [t.includes("/") ? t : `${opened.key}/${t}`, r]));
      setShown({ read: embedIn(library, parseAddress(LARGE_ADDRESS)!, "big.table", { readsIndex: true }), index: { openIndexDatabase: openWebDatabase, first: keyed } });
    })();
  }, []);
  const files = useMemo(() => ({ write: async () => {} }), []);
  return (
    <html.section style={styles.case}>
      <html.p style={styles.note}>
        a single file of {LARGE_ROWS.toLocaleString("en")} rows, read through the index · <html.code>{LARGE_ADDRESS}</html.code>
      </html.p>
      {shown ? <TableEmbed read={shown.read} files={files} index={shown.index} address={LARGE_ADDRESS} readOnly /> : <TableEmbed read={null} files={files} address={LARGE_ADDRESS} />}
    </html.section>
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
