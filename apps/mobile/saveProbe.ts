// How long the screen's reads wait while a large table is saved: the
// app's own index host (indexHost.ts), with nothing drawn. Run from the
// SQLite probe screen's link (`save=<url of a .table.zip>`), in a
// development build or a measuring one. Nothing here runs otherwise.

import { remoteViewRows } from "@workspace.sh/table-app";
import { openIndexDatabase, openZip } from "./indexHost";

export interface SaveProbe {
  rows: number;
  /** Milliseconds to read the archive into its index. */
  buildMs: number;
  /** Reads of 200 rows at places through the table, one after another: with nothing else going on, and while it is saved. */
  quiet: { reads: number; slowestMs: number; medianMs: number };
  saving: { reads: number; slowestMs: number; medianMs: number };
  saveMs: number;
  /** What the save answered: true when the file was written and said to be saved. */
  saved: unknown;
}

const median = (ms: number[]) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)] ?? 0;

export async function saveProbe(url: string, say: (line: string) => void): Promise<SaveProbe> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const { opened } = await openZip(bytes, [`probe-${Date.now()}`]);
  const [name, table] = Object.entries(opened.bundle.tables).find(([, t]) => t.indexed)!;
  const db = openIndexDatabase(opened.key);
  const built = performance.now();
  const count = await db.ensure(name, table.schema, (done, total) => {
    if (done % 100_000 < 5000) say(`reading ${done} of about ${total}`);
  });
  const buildMs = Math.round(performance.now() - built);
  say(`built ${count} rows in ${buildMs} ms`);
  const view = await remoteViewRows(db.rows, name, { ...table, indexed: { count, version: 1 } }, { id: "", name: "", layout: "table" }, "");
  // The same places each time: a spread through the table, far from one another.
  const places = Array.from({ length: 40 }, (_, i) => Math.floor(((i * 7919) % 1000) * (count / 1000)));
  const read = async (until: () => boolean, least: number) => {
    const ms: number[] = [];
    for (let i = 0; i < 400 && (ms.length < least || !until()); i++) {
      const at = places[i % places.length]!;
      const from = performance.now();
      await view.rows(at, Math.min(count, at + 200));
      ms.push(performance.now() - from);
      await new Promise((go) => setTimeout(go, 25));
    }
    return { reads: ms.length, slowestMs: Math.round(Math.max(...ms)), medianMs: Math.round(median(ms)) };
  };
  const quiet = await read(() => true, 40);
  say(`quiet: ${JSON.stringify(quiet)}`);
  let done = false;
  const from = performance.now();
  let saveMs = 0;
  const saving = db.save(name, table.schema, true).then((saved: unknown) => {
    saveMs = Math.round(performance.now() - from);
    done = true;
    return saved;
  });
  const during = await read(() => done, 5);
  const saved = await saving;
  say(`saving: ${JSON.stringify(during)}, the save ${saveMs} ms`);
  view.release();
  return { rows: count, buildMs, quiet, saving: during, saveMs, saved: saved ?? "no answer (the save before this change)" };
}
