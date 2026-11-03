import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { embedAddresses } from "./embed.ts";
import type { EmbedCases } from "./embedCases.ts";
import { readEmbedCases } from "./embedCasesNode.ts";

// The embed cases every platform checks (workspace-fixtures, Fixtures/markdown/*.cases.json):
// each document's links give what its cases file says, as this library reads them.
const markdown = fileURLToPath(new URL("../../../workspace-fixtures/Fixtures/markdown/", import.meta.url));
const documents = readdirSync(markdown).filter((name) => name.endsWith(".cases.json")).map((name) => name.replace(/\.cases\.json$/, ".md"));

test("the fixtures have documents of embeds, each with its cases", () => {
  assert.ok(documents.includes("Table Embeds.md") && documents.includes("Large Table Embeds.md"), documents.join(", "));
});

for (const document of documents) {
  test(`${document}: each link gives what its cases file says`, async () => {
    const written = JSON.parse(readFileSync(join(markdown, document.replace(/\.md$/, ".cases.json")), "utf8")) as EmbedCases;
    const read = await readEmbedCases(join(markdown, document));
    assert.equal(read.cases.length, written.cases.length, "the cases file has a case for each link, and no more");
    for (const [i, c] of read.cases.entries()) assert.deepEqual(c, written.cases[i], `case ${i + 1}: ${c.line}`);
  });

  test(`${document}: every embed in it is a case`, () => {
    const text = readFileSync(join(markdown, document), "utf8");
    const written = JSON.parse(readFileSync(join(markdown, document.replace(/\.md$/, ".cases.json")), "utf8")) as EmbedCases;
    const cased = new Set(written.cases.map((c) => c.address));
    for (const address of embedAddresses(text)) assert.ok(cased.has(address), address);
  });
}
