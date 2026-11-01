import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jsonFileStore } from "./node.ts";
import { loadDisplay, saveDisplay } from "./displaySettings.ts";

test("a JSON file store keeps settings between runs, and starts empty from nothing or junk", () => {
  const dir = mkdtempSync(join(tmpdir(), "table-app-store-"));
  try {
    const path = join(dir, "sub", "settings.json");
    const first = jsonFileStore(path);
    assert.equal(first.getItem("k"), null);
    saveDisplay(first, { locale: "fr-FR", dateFormat: "long" });
    assert.deepEqual(loadDisplay(jsonFileStore(path)), { locale: "fr-FR", dateFormat: "long" });
    const again = jsonFileStore(path);
    again.removeItem("table-demo:display");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {});
    writeFileSync(path, "not json");
    assert.equal(jsonFileStore(path).getItem("anything"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("attaching copies the file into the table's attachments folder under a free name", async () => {
  const { attachFile } = await import("./node.ts");
  const dir = mkdtempSync(join(tmpdir(), "table-app-attach-"));
  try {
    const source = join(dir, "logo.svg");
    writeFileSync(source, "<svg/>");
    const table = join(dir, "t");
    assert.equal(attachFile(table, source), "logo.svg");
    assert.equal(attachFile(table, source), "logo-2.svg");
    assert.equal(readFileSync(join(table, "attachments", "logo-2.svg"), "utf8"), "<svg/>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a table's attachments are listed from its folder, sorted; none without the folder", async () => {
  const { attachmentsIn } = await import("./node.ts");
  const dir = mkdtempSync(join(tmpdir(), "table-app-list-"));
  try {
    assert.deepEqual(attachmentsIn(dir), []);
    const folder = join(dir, "attachments");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(folder, "sub"), { recursive: true });
    writeFileSync(join(folder, "b.png"), "");
    writeFileSync(join(folder, "a.svg"), "");
    assert.deepEqual(attachmentsIn(dir), ["a.svg", "b.png"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("history is appended to: a new file is made, an old one is only added to, and one with no line end gets it first", async () => {
  const { appendHistory } = await import("./node.ts");
  const { parseEditLog, stampEdits } = await import("@workspace.sh/table-core");
  const dir = mkdtempSync(join(tmpdir(), "table-app-history-"));
  try {
    const table = join(dir, "x.table", "tables", "tasks");
    const file = join(table, "history.ndjson");
    const first = stampEdits([{ op: "set", row: "p1", field: "a", to: 1 }]);
    // The table's folder needn't be there yet.
    await appendHistory(table, first);
    assert.deepEqual(parseEditLog(readFileSync(file, "utf8")).events, first);
    const second = stampEdits([
      { op: "insert", row: "p2", values: { id: "p2" } },
      { op: "page", row: "p1", to: "été\n" },
    ]);
    const before = readFileSync(file, "utf8");
    await appendHistory(table, second);
    const after = readFileSync(file, "utf8");
    assert.ok(after.startsWith(before), "what was there is untouched");
    assert.deepEqual(parseEditLog(after).events, [...first, ...second]);
    assert.ok(after.endsWith("\n"));
    // Nothing to add: the file isn't touched.
    await appendHistory(table, []);
    assert.equal(readFileSync(file, "utf8"), after);
    // Another writer left it without a line end, and with a line this one can't read.
    const foreign = '{"id":"x","at":"2026-01-01T00:00:00Z","op":"schema","row":"p1"}';
    writeFileSync(file, after + foreign);
    const third = stampEdits([{ op: "delete", row: "p2", values: { id: "p2" } }]);
    await appendHistory(table, third);
    const text = readFileSync(file, "utf8");
    assert.ok(text.startsWith(after + foreign + "\n"));
    assert.deepEqual(parseEditLog(text), { events: [...first, ...second, ...third], skipped: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copies of the examples are made once, and not of the ones named as closed", async () => {
  const { copiesOf, bundlesIn } = await import("./node.ts");
  const { mkdirSync } = await import("node:fs");
  const { basename } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "table-app-copies-"));
  try {
    const from = join(dir, "from");
    for (const name of ["a.table", "b.table", "c.table"]) {
      mkdirSync(join(from, name), { recursive: true });
      writeFileSync(join(from, name, "meta.json"), name);
    }
    const to = join(dir, "to");
    assert.deepEqual(copiesOf(from, to, ["b"]).map((p) => basename(p)), ["a.table", "c.table"]);
    assert.deepEqual(bundlesIn(to).map((p) => basename(p)), ["a.table", "c.table"]);
    // Edited since: left as it is.
    writeFileSync(join(to, "a.table", "meta.json"), "edited");
    assert.deepEqual(copiesOf(from, to).map((p) => basename(p)), ["a.table", "b.table", "c.table"]);
    assert.equal(readFileSync(join(to, "a.table", "meta.json"), "utf8"), "edited");
    assert.equal(readFileSync(join(to, "b.table", "meta.json"), "utf8"), "b.table");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

