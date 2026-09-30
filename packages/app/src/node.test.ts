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
