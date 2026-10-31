import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { TABLE_TYPE_DECLARATIONS } from "./tableTypes.js";

const require = createRequire(import.meta.url);
const plugin = require("../app.plugin.cjs") as ((config: object, options?: { declare?: string }) => { ios: { infoPlist: Record<string, unknown> } }) & {
  TABLE_TYPE_DECLARATIONS: unknown;
};

test("the config plugin declares the .table types as core names them", () => {
  assert.deepEqual(plugin.TABLE_TYPE_DECLARATIONS, TABLE_TYPE_DECLARATIONS);
});

test("the config plugin exports or imports them, keeping what else the app declares", () => {
  const other = { UTTypeIdentifier: "sh.workspace.canvas" };
  const exported = plugin({ ios: { infoPlist: { UTExportedTypeDeclarations: [other] } } }, { declare: "exported" });
  assert.deepEqual(exported.ios.infoPlist.UTExportedTypeDeclarations, [other, ...TABLE_TYPE_DECLARATIONS]);
  const imported = plugin({}, {});
  assert.deepEqual(imported.ios.infoPlist.UTImportedTypeDeclarations, TABLE_TYPE_DECLARATIONS);
  const again = plugin(exported, { declare: "exported" });
  assert.deepEqual(again.ios.infoPlist.UTExportedTypeDeclarations, [other, ...TABLE_TYPE_DECLARATIONS], "applied twice, declared once");
});
