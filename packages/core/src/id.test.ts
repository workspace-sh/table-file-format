import { test } from "node:test";
import assert from "node:assert/strict";
import { newId, ID_ALPHABET, ID_LENGTH } from "./id";

test("newId returns a non-empty string", () => {
  const id = newId();
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
});

test("newId produces unique values across many calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) ids.add(newId());
  assert.equal(ids.size, 1000);
});

test("minted ids are 25-char lowercase base36 (case-safe for filenames)", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(newId(), /^[0-9a-z]{25}$/);
  }
});

test("alphabet contains no case-fold ambiguity", () => {
  // The defect class behind issue #42: ids become bodies/{id}.md
  // filenames, and case-insensitive filesystems fold case. An
  // alphabet is safe exactly when lowercasing it changes nothing.
  assert.equal(ID_ALPHABET, ID_ALPHABET.toLowerCase());
  assert.equal(new Set(ID_ALPHABET).size, ID_ALPHABET.length);
  assert.equal(ID_LENGTH, 25);
});

test("ids remain distinct under case-insensitive path comparison", () => {
  const folded = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    folded.add(newId().toLowerCase());
  }
  // With a case-safe alphabet, case-folding is the identity — 1000
  // unique ids MUST stay 1000 unique filenames.
  assert.equal(folded.size, 1000);
});
