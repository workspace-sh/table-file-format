import { test } from "node:test";
import assert from "node:assert/strict";

import { textDirection } from "./direction.js";

test("right-to-left languages and scripts", () => {
  for (const tag of ["ar", "ar-EG", "he", "he-IL", "fa-IR", "ur-PK", "yi", "ckb", "pa-Arab", "az-Arab-IR"]) {
    assert.equal(textDirection(tag), "rtl", tag);
  }
});

test("everything else reads left to right, including a Latin-script form of an RTL language", () => {
  for (const tag of ["en-GB", "fr", "ja-JP", "ku", "ur-Latn", "uz-Latn-UZ", undefined, ""]) {
    assert.equal(textDirection(tag), "ltr", String(tag));
  }
});
