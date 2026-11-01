import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64, toBase64 } from "./base64.js";

test("bytes go to base64 and back, past the size one call can take", () => {
  const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
  const text = toBase64(bytes);
  assert.equal(text, Buffer.from(bytes).toString("base64"));
  assert.deepEqual(fromBase64(text), bytes);
});
