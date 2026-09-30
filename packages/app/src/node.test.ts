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
