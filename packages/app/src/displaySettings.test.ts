import { test } from "node:test";
import assert from "node:assert/strict";

import { DISPLAY_KEY, loadDisplay, saveDisplay, displayChoices, withDisplayChoice, LOCALES } from "./displaySettings.ts";
import type { KeyValueStore } from "./savedTables.ts";

function memory(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

test("display settings come back as saved", () => {
  const store = memory();
  saveDisplay(store, { locale: "en-GB", dateFormat: "long" });
  assert.deepEqual(loadDisplay(store), { locale: "en-GB", dateFormat: "long" });
});

test("nothing saved means the browser's locale and the table's own formats", () => {
  assert.deepEqual(loadDisplay(memory()), {});
  assert.deepEqual(loadDisplay(null), {});
});

test("anything unknown is dropped, not trusted", () => {
  for (const raw of ["nope", "null", '{"locale":"xx-XX","dateFormat":"dd/mm"}', '{"locale":5}']) {
    assert.deepEqual(loadDisplay(memory({ [DISPLAY_KEY]: raw })), {}, raw);
  }
  assert.deepEqual(loadDisplay(memory({ [DISPLAY_KEY]: '{"locale":"de-DE","dateFormat":"bogus"}' })), { locale: "de-DE" });
});

test("formula syntax: the stored form is kept; Excel style is the default, so it isn't", () => {
  const store = memory();
  saveDisplay(store, { formulaSyntax: "stored" });
  assert.deepEqual(loadDisplay(store), { formulaSyntax: "stored" });
  saveDisplay(store, { formulaSyntax: "excel" });
  assert.deepEqual(loadDisplay(store), {});
  assert.deepEqual(loadDisplay(memory({ [DISPLAY_KEY]: '{"formulaSyntax":"lisp"}' })), {});
});

test("displayChoices: three rows, in order, with the chosen values", () => {
  const rows = displayChoices({}, "en-GB");
  assert.deepEqual(rows.map((r) => r.kind), ["locale", "dateFormat", "formulaSyntax"]);
  assert.deepEqual(rows.map((r) => r.value), ["", "iso", "excel"]);
  assert.equal(rows[0]!.options[0]!.label, "Browser (en-GB)");
  assert.equal(rows[0]!.options.length, LOCALES.length + 1);
  assert.equal(rows[1]!.options.find((o) => o.value === "iso")!.label, "ISO (2026-04-20)");
  assert.equal(rows[2]!.options.find((o) => o.value === "stored")!.label, "Stored form ((+ a b))");
  assert.equal(rows[0]!.note, undefined);
  assert.ok(rows[1]!.note && rows[2]!.note);
  assert.equal(displayChoices({}, "fr-FR", "System")[0]!.options[0]!.label, "System (fr-FR)");
  const chosen = displayChoices({ locale: "de-DE", dateFormat: "long", formulaSyntax: "stored" }, "en-GB");
  assert.deepEqual(chosen.map((r) => r.value), ["de-DE", "long", "stored"]);
});

test("withDisplayChoice: a default is stored as absent", () => {
  assert.deepEqual(withDisplayChoice({}, "locale", "fr-FR"), { locale: "fr-FR" });
  assert.equal(withDisplayChoice({ locale: "fr-FR" }, "locale", "").locale, undefined);
  assert.equal(withDisplayChoice({ dateFormat: "long" }, "dateFormat", "iso").dateFormat, undefined);
  assert.equal(withDisplayChoice({}, "dateFormat", "weekday").dateFormat, "weekday");
  assert.equal(withDisplayChoice({}, "formulaSyntax", "stored").formulaSyntax, "stored");
  assert.equal(withDisplayChoice({ formulaSyntax: "stored" }, "formulaSyntax", "excel").formulaSyntax, undefined);
  // The others are kept.
  assert.deepEqual(withDisplayChoice({ locale: "ja-JP", dateFormat: "short" }, "formulaSyntax", "stored"), {
    locale: "ja-JP",
    dateFormat: "short",
    formulaSyntax: "stored",
  });
});
