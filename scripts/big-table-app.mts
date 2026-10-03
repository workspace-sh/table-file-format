// The app-state side of a large table (#126, Phase 2): open a big-<rows>.table.zip
// as the apps do, then time derive() on the renders an app makes: the first,
// one after a row edit, one after something that doesn't touch the data
// (the settings panel opening), and the write the edit schedules.
//
//   node --conditions=source --import tsx scripts/big-table-app.mts <zip>

import { readFile } from "node:fs/promises";
import { openArchive } from "../packages/app/src/tableFiles.ts";
import { fromBundle } from "../packages/app/src/bundles.ts";
import { derive, initialAppState, tableApp } from "../packages/app/src/appState.ts";

const bytes = new Uint8Array(await readFile(process.argv[2]!));
const opened = await openArchive(bytes, []);
const start = initialAppState({ tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta } });
const time = <T,>(f: () => T): [T, number] => {
  const t = performance.now();
  const v = f();
  return [v, Math.round((performance.now() - t) * 10) / 10];
};

const [, first] = time(() => derive(start));
const [, again] = time(() => derive(start));
const id = start.tables[start.active]!.rows[0]!.id;
const [edited, reduce] = time(() => tableApp(start, { type: "updateRow", rowId: id, field: "title", value: "Edited" }));
const [, afterEdit] = time(() => derive(edited));
const [panel] = [tableApp(edited, { type: "settings", open: true })];
const [, afterPanel] = time(() => derive(panel));
const [, stringify] = time(() => JSON.stringify({ tables: edited.tables, bundles: edited.bundles }).length);
console.log(JSON.stringify({ rows: start.tables[start.active]!.rows.length, firstMs: first, sameStateMs: again, reduceMs: reduce, afterEditMs: afterEdit, afterPanelMs: afterPanel, saveStringifyMs: stringify }));
