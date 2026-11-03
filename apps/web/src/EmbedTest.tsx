// Development only (`#embed-test`): the embed cases every platform checks
// (workspace-fixtures, Fixtures/markdown/*.cases.json), each drawn by
// table-app's TableEmbed as a document in Fixtures/markdown would show it,
// over the fixtures written into a folder in memory. Each case is marked
// with whether it draws what its cases file says, and the heading counts
// them. Not in a production build.

import { useEffect, useMemo, useRef, useState } from "react";
import { css, html } from "react-strict-dom";
import { memoryFs, writeBundleTo } from "@workspace.sh/table-core/io";
import {
  embedFilesWith,
  fromBundle,
  readEmbedWith,
  toBundle,
  type EmbedCase,
  type EmbedCases,
  type EmbedRead,
  type Library,
} from "@workspace.sh/table-app";
import { openArchiveInWorker, openWebDatabase } from "./sqlite/client";
import {
  TableEmbed,
  type EmbedIndex,
} from "@workspace.sh/table-app/embed-view";
import { bundles, tables } from "./loadFixture";

const caseFiles = import.meta.glob<EmbedCases>(
  "../../../workspace-fixtures/Fixtures/markdown/*.cases.json",
  { eager: true, import: "default" },
);
// The files the cases link to that aren't the example folders loadFixture reads.
const singleFiles = import.meta.glob<string>(
  "../../../workspace-fixtures/Fixtures/table/single-file/*.table",
  { eager: true, query: "?url", import: "default" },
);
const largeFiles = import.meta.glob<string>(
  "../../../workspace-fixtures/Fixtures/table/large/big-50000.table",
  { eager: true, query: "?url", import: "default" },
);
const otherFiles = import.meta.glob<string>(
  "../../../workspace-fixtures/Fixtures/table/broken/not-a-table.table",
  { eager: true, query: "?raw", import: "default" },
);

const DOCS = "/ws/markdown";
const TABLES = "/ws/table";
/** "…/Fixtures/table/single-file/crm.table" → "single-file/crm.table" */
const inTable = (path: string) =>
  path.slice(path.indexOf("/Fixtures/table/") + "/Fixtures/table/".length);
const written = new WeakMap<object, Promise<void>>();
const once = (fs: object, write: () => Promise<void>): Promise<void> => {
  if (!written.has(fs)) written.set(fs, write());
  return written.get(fs)!;
};

const documents = Object.values(caseFiles).sort((a, b) =>
  a.document.localeCompare(b.document),
);
const all = documents.flatMap((d) =>
  d.cases.map((c) => ({ document: d.document, ...c })),
);

/** What a case's drawing shows that its cases file says it should, or why not. */
function verdict(c: EmbedCase, text: string): string | null {
  const e = c.expect;
  if ("link" in e) return null;
  if ("problem" in e)
    return text.includes(e.problem) ? "" : `no “${e.problem}”`;
  const missing = e.first.filter((title) => !text.includes(title));
  if (missing.length > 0)
    return `no ${missing.map((t) => `“${t}”`).join(", ")}`;
  if (e.more && !text.includes(e.more)) return `no “${e.more}”`;
  if (!e.more && /Show [\d,]+ more (row|card)/.test(text))
    return "a “more” line it shouldn’t have";
  for (const g of e.groups ?? [])
    if (!text.includes(g.label)) return `no group “${g.label}”`;
  return "";
}

export function EmbedTest() {
  const fs = useMemo(() => memoryFs(), []);
  // What each single file gave its index: its first rows, for drawing while the rest is read.
  const firsts = useRef(new Map<string, EmbedIndex>());
  // Written once, however many times React runs this (twice in development).
  const ready = useMemo(
    () =>
      once(fs, async () => {
        for (const key of Object.keys(bundles))
          await writeBundleTo(
            fs,
            `${TABLES}/${key}.table`,
            toBundle(tables, bundles, key),
          );
        await fs.mkdir(`${TABLES}/single-file`);
        await fs.mkdir(`${TABLES}/large`);
        await fs.mkdir(`${TABLES}/broken`);
        for (const [path, url] of Object.entries({
          ...singleFiles,
          ...largeFiles,
        })) {
          await fs.writeBytes!(
            `${TABLES}/${inTable(path)}`,
            new Uint8Array(await (await fetch(url)).arrayBuffer()),
          );
        }
        for (const [path, text] of Object.entries(otherFiles))
          await fs.writeText(`${TABLES}/${inTable(path)}`, text);
      }),
    [fs],
  );
  const reading = useMemo(
    () => ({
      readsIndex: true,
      // A single file, as the web opens one: read into its index in the page's worker.
      openFile: async (path: string): Promise<Library> => {
        const bytes = await fs.readBytes!(path);
        if (!bytes) throw new Error("it isn’t there");
        // A copy: the worker takes the bytes it's given, and the folder keeps its own.
        const { opened, first, index } = await openArchiveInWorker(
          bytes.slice(),
          [],
        );
        if (index) {
          const keyed = Object.fromEntries(
            Object.entries(first).map(([t, r]) => [
              t.includes("/") ? t : `${opened.key}/${t}`,
              r,
            ]),
          );
          firsts.current.set(opened.key, {
            openIndexDatabase: openWebDatabase,
            first: keyed,
          });
        }
        return {
          tables: fromBundle(opened.key, opened.bundle),
          bundles: { [opened.key]: opened.bundle.meta },
          paths: { [opened.key]: path },
          problems: {},
        };
      },
    }),
    [fs],
  );
  const [reads, setReads] = useState<(EmbedRead | null)[]>(() =>
    all.map(() => null),
  );
  useEffect(() => {
    let current = true;
    void ready
      .then(() =>
        Promise.all(
          all.map((c) =>
            "link" in c.expect
              ? null
              : readEmbedWith(
                  fs,
                  { address: c.address, baseDir: DOCS, within: "/ws" },
                  reading,
                ),
          ),
        ),
      )
      .then((done) => current && setReads(done));
    return () => {
      current = false;
    };
  }, [fs, ready, reading]);
  const files = useMemo(() => embedFilesWith(fs), [fs]);

  // Each case's verdict, from what its embed draws, checked as the page is scrolled through.
  const sections = useRef<(HTMLElement | null)[]>([]);
  const [verdicts, setVerdicts] = useState<(string | null)[]>(() =>
    all.map(() => "not drawn yet"),
  );
  useEffect(() => {
    // A case passes once it has drawn all it should: a table keeps only the rows on screen.
    const check = () =>
      setVerdicts((was) =>
        all.map((c, i) =>
          was[i] === ""
            ? ""
            : verdict(c, sections.current[i]?.textContent ?? ""),
        ),
      );
    const timer = setInterval(check, 500);
    return () => clearInterval(timer);
  }, []);
  const checked = verdicts.filter((v) => v !== null);
  const passed = checked.filter((v) => v === "").length;

  return (
    <html.div style={styles.page}>
      <html.h1 style={styles.heading}>Table embeds</html.h1>
      <html.p style={styles.lede}>
        The embed cases in workspace-fixtures (Fixtures/markdown/*.cases.json),
        each drawn by table-app’s TableEmbed as a document in Fixtures/markdown
        would show it.
      </html.p>
      <html.p style={styles.summary} data-testid="embed-cases-summary">
        {passed} of {checked.length} cases as expected
      </html.p>
      {all.map((c, i) => {
        const read = reads[i] ?? null;
        const index =
          read?.kind === "shown"
            ? firsts.current.get(read.key.split("/")[0]!)
            : undefined;
        const v = verdicts[i];
        return (
          <html.section key={`${c.document} ${i}`} style={styles.case}>
            <html.p style={styles.note}>
              {v === null ? "○ a link" : v === "" ? "✓" : `✗ ${v}`} ·{" "}
              {c.document} · <html.code>{c.address}</html.code>
            </html.p>
            {"link" in c.expect ? null : (
              // What the embed draws, apart from the note above it, which repeats what's expected.
              <html.div
                ref={(el: HTMLElement | null) =>
                  void (sections.current[i] = el)
                }
              >
                <TableEmbed
                  read={read}
                  files={files}
                  address={c.address}
                  {...(index ? { index } : {})}
                  {...((read?.kind === "shown" &&
                    read.library.paths[read.key.split("/")[0]!]?.includes(
                      "/single-file/",
                    )) ||
                  index
                    ? { readOnly: true }
                    : {})}
                />
              </html.div>
            )}
          </html.section>
        );
      })}
    </html.div>
  );
}

const styles = css.create({
  page: {
    maxWidth: 960,
    marginInline: "auto",
    paddingBlock: 32,
    paddingInline: 16,
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  heading: { fontSize: 24, margin: 0 },
  lede: { margin: 0, opacity: 0.7 },
  summary: { margin: 0, fontWeight: 600 },
  case: { display: "flex", flexDirection: "column", gap: 8 },
  note: { margin: 0, fontSize: 13, opacity: 0.7 },
});
