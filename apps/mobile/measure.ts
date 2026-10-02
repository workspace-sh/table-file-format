// Measuring large tables (#126): open a .table.zip from a URL as a picked
// file is opened, and time each step. Used by the development hook
// (__tableMobile.openZipFrom) and, in a build made with
// EXPO_PUBLIC_TABLE_MEASURE=1, by runMeasure at launch, which asks a local
// server (scripts/measure-server.py) what to open and posts back the times.
// Nothing here runs in an ordinary build.

import type { Dispatch } from "react";
import { fromBundle, openArchive, type AppAction, type AppState } from "@workspace.sh/table-app";

export const MEASURING = process.env.EXPO_PUBLIC_TABLE_MEASURE === "1";
/** Where the measuring server is: the Simulator reaches the Mac as localhost. */
const SERVER = "http://localhost:5198";

const twoFrames = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

export interface Opened {
  key: string;
  /** Milliseconds: downloading it, reading it (unzip and parse), showing it (render, two frames). */
  fetch: number;
  read: number;
  show: number;
}

export async function openZipFrom(url: string, state: AppState, dispatch: Dispatch<AppAction>): Promise<Opened> {
  const t0 = performance.now();
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const t1 = performance.now();
  const opened = await openArchive(bytes, Object.keys(state.bundles));
  const t2 = performance.now();
  dispatch({
    type: "opened",
    library: { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} },
    skipped: opened.skipped,
  });
  await twoFrames();
  return { key: opened.key, fetch: Math.round(t1 - t0), read: Math.round(t2 - t1), show: Math.round(performance.now() - t2) };
}

/** Milliseconds from editing the first row's title to the screen showing it. */
export async function timeEdit(state: AppState, dispatch: Dispatch<AppAction>): Promise<number> {
  const id = state.tables[state.active]?.rows[0]?.id;
  if (!id) return -1;
  const t0 = performance.now();
  dispatch({ type: "updateRow", rowId: id, field: "title", value: "Edited" });
  await twoFrames();
  return Math.round(performance.now() - t0);
}

/** Sends what was measured to the measuring server. */
export const report = (body: unknown) => fetch(`${SERVER}/result`, { method: "POST", body: JSON.stringify(body) }).catch(() => {});

/**
 * At launch in a measuring build: open what the server names, edit once,
 * post the times. "bench <flash|legend> <rows>" opens the list benchmark
 * (app/bench.tsx) instead, which posts its own.
 */
export async function runMeasure(getState: () => AppState, dispatch: Dispatch<AppAction>, navigate: (path: string) => void): Promise<void> {
  try {
    const name = (await (await fetch(`${SERVER}/next`)).text()).trim();
    if (!name) return;
    const bench = /^bench (flash|legend|screen) (\d+)$/.exec(name);
    if (bench) {
      navigate(`/bench?lib=${bench[1]}&n=${bench[2]}`);
      return;
    }
    const opened = await openZipFrom(`${SERVER}/${name}`, getState(), dispatch);
    await report({ name, step: "opened", ...opened });
    await new Promise((done) => setTimeout(done, 500));
    const edit = await timeEdit(getState(), dispatch);
    await report({ name, step: "edited", edit });
  } catch (error) {
    await report({ step: "error", message: String(error) });
  }
}
