// Timings of a large table in the app itself (#442), as the web's and iOS's
// probes take theirs (docs/LARGE-TABLES.md). Only with TABLE_MEASURE=1,
// from scripts/measure-large.sh: the built app, opened on a table made by
// scripts/big-table.mts, under a headless compositor. It watches the app's
// own widgets, does what a person would (a jump, a search, an edit), and
// prints how long each took, from the action to the frame that first
// showed its result, and one more drawn after it.

import * as Gtk from "@gtkx/gi/gtk";
import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import type { AppAction } from "@workspace.sh/table-app";

/** The app's dispatch, set by App while it measures: an edit is made as its controls make one. */
let act: ((action: AppAction) => void) | undefined;
export const measuring = process.env["TABLE_MEASURE"] === "1";
export function measureWith(dispatch: (action: AppAction) => void): void {
  act = dispatch;
}

const say = (what: string, ms: number) => console.log(`[measure] ${what}: ${Math.round(ms)} ms`);

/** With TABLE_MEASURE_PROFILE set to a folder: a CPU profile of each step timed, written there as <step>.cpuprofile. */
const profiles = process.env["TABLE_MEASURE_PROFILE"];
let session: Session | undefined;
async function profiled<T>(what: string, run: () => Promise<T>): Promise<T> {
  if (!profiles) return run();
  if (!session) {
    session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 200 });
  }
  await session.post("Profiler.start");
  try {
    return await run();
  } finally {
    const { profile } = await session.post("Profiler.stop");
    writeFileSync(`${profiles}/${what.replaceAll(/\W+/g, "-")}.cpuprofile`, JSON.stringify(profile));
  }
}

/** Every mapped label in the app's windows whose text matches. */
function labels(match: RegExp | string): Gtk.Label[] {
  const found: Gtk.Label[] = [];
  const walk = (w: Gtk.Widget) => {
    if (!w.getMapped()) return;
    if (w instanceof Gtk.Label) {
      const text = w.getLabel();
      if (typeof match === "string" ? text === match : match.test(text)) found.push(w);
    }
    for (let c = w.getFirstChild(); c; c = c.getNextSibling()) walk(c);
  };
  each((w) => walk(w));
  return found;
}

function each(run: (window: Gtk.Widget) => void) {
  const windows = Gtk.Window.getToplevels();
  for (let i = 0; i < windows.getNItems(); i++) run(windows.getItem(i) as unknown as Gtk.Widget);
}

function find<T extends Gtk.Widget>(kind: abstract new (...args: never[]) => T): T | undefined {
  let found: T | undefined;
  const walk = (w: Gtk.Widget) => {
    if (found || !w.getMapped()) return;
    if (w instanceof kind) found = w;
    for (let c = w.getFirstChild(); c && !found; c = c.getNextSibling()) walk(c);
  };
  each(walk);
  return found;
}

/**
 * Asked at each frame the window draws until it holds, then one more frame:
 * what a person would see. Once a frame, not every few milliseconds, as a
 * look over every widget costs the app's thread time of its own. Resolves
 * with when it first held.
 */
function until<T>(what: string, check: () => T | undefined | null | false, timeoutMs = 120_000): Promise<{ at: number; value: T }> {
  return new Promise((resolve, reject) => {
    const window = Gtk.Window.getToplevels().getItem(0) as unknown as Gtk.Widget | null;
    const now = check();
    if (now || !window) {
      if (now) resolve({ at: performance.now(), value: now });
      else setTimeout(() => until(what, check, timeoutMs).then(resolve, reject), 10);
      return;
    }
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    let held: { at: number; value: T } | undefined;
    window.addTickCallback(() => {
      if (held) {
        clearTimeout(timer);
        resolve(held);
        return false;
      }
      const value = check();
      if (value) held = { at: performance.now(), value };
      return true;
    });
  });
}

const TITLE = /^\w+ [\w ]+ \d+$/;
const rowNumbers = () => labels(TITLE).map((l) => Number(/(\d+)$/.exec(l.getLabel())![1]));
const reading = () => labels(/rows read/).length > 0;
const countOf = (label: Gtk.Label) =>
  label
    .getLabel()
    .match(/[\d,]+/g)!
    .map((n) => Number(n.replaceAll(",", "")));
const viewCount = () => {
  const label = labels(/^[\d,]+ of [\d,]+ rows$/)[0];
  return label ? countOf(label) : undefined;
};

function scrollerOf(w: Gtk.Widget): Gtk.ScrolledWindow {
  let x: Gtk.Widget | null = w;
  while (x && !(x instanceof Gtk.ScrolledWindow)) x = x.getParent();
  return x as Gtk.ScrolledWindow;
}

const jump = (what: string, fraction: number, rows: number) => profiled(what, () => jumpTo(what, fraction, rows));
async function jumpTo(what: string, fraction: number, rows: number) {
  const { value: row } = await until("rows on screen", () => labels(TITLE)[0]);
  const adjustment = scrollerOf(row).getVadjustment();
  const target = Math.max(1, rows * fraction);
  const t0 = performance.now();
  adjustment.setValue((adjustment.getUpper() - adjustment.getPageSize()) * fraction);
  const { at } = await until(what, () => {
    const shown = rowNumbers();
    return shown.length > 5 && shown.some((n) => Math.abs(n - target) <= Math.max(50, rows * 0.01));
  });
  say(what, at - t0);
  if (fraction === 0.5) console.log(`[measure] rows built: ${labels(TITLE).length}, widgets in the window: ${widgetCount()}`);
}

function widgetCount(): number {
  let n = 0;
  const walk = (w: Gtk.Widget) => {
    n++;
    for (let c = w.getFirstChild(); c; c = c.getNextSibling()) walk(c);
  };
  each(walk);
  return n;
}

/** The run, from the app's start (`startedAt`, before its window). Ends the app when it's done. */
export async function measure(startedAt: number, rowId: string | undefined, quit: () => void): Promise<void> {
  try {
    const window = await until("the window", () => {
      let shown = false;
      each((w) => (shown ||= w.getMapped()));
      return shown;
    });
    say("the window, from the app's start", window.at - startedAt);
    // The longest the window went without a frame (the app's thread is the one that draws it).
    let last = performance.now();
    let longest = 0;
    let watching = true;
    (Gtk.Window.getToplevels().getItem(0) as unknown as Gtk.Widget).addTickCallback(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      return watching;
    });
    const first = await until("first rows", () => labels(TITLE)[0]);
    say("first rows, from the app's start", first.at - startedAt);
    // Whether its index is made, or was there already: the launcher says which run this is.
    const read = process.env["TABLE_MEASURE_RUN"] !== "again";
    const ready = await until("the table ready", () => !reading() && labels(/^Showing rows as stored/).length === 0 && viewCount(), 30 * 60_000);
    say(read ? "table ready (its index made)" : "table ready (its index as it was)", ready.at - startedAt);
    watching = false;
    say("the longest the window went without a frame, until then", longest);
    const rows = ready.value[1]!;
    if (!read) return;

    await jump("jump to the middle", 0.5, rows);
    await jump("jump to the last row", 1, rows);

    const search = find(Gtk.SearchEntry)!;
    let t0 = performance.now();
    search.setText("Quill audit");
    const found = await until("a search", () => labels(/^[\d,]+ of [\d,]+ matching$/)[0]);
    say("a search, before its index is whole", found.at - t0);
    search.setText("");
    await until("the search cleared", () => viewCount()?.[0] === rows);

    await jump("jump to the start", 0, rows);
    if (act && rowId) {
      const edit = await profiled("an edit shown", () => {
        t0 = performance.now();
        act!({ type: "updateRow", rowId, field: "title", value: "Zed measured" });
        return until("the edit", () => labels("Zed measured")[0]);
      });
      say("an edit shown", edit.at - t0);
      // A save starts 400 ms after the last edit: half a second in, a place not read before.
      await new Promise((r) => setTimeout(r, 500));
      await jump("a place not read before, while the edit is saved", 0.75, rows);
      // Its save ended before the app is: opened again, the index is as the file is.
      await new Promise((r) => setTimeout(r, 30_000));
    }
  } catch (error) {
    console.log(`[measure] failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    console.log("[measure] done");
    quit();
  }
}
