// Writes the cases file beside a document of embeds in workspace-fixtures
// (Fixtures/markdown/<name>.cases.json): each link to a .table, in the
// order the document has them, with what it gives as this library reads it.
// Read what it writes before committing it: the document's own words say
// what each case should show, and the cases file must agree with them.
// packages/app's embedCases.test.ts checks the files stay as written.
//
//   npm run fixtures:embed-cases -- "workspace-fixtures/Fixtures/markdown/Table Embeds.md"

import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readEmbedCases } from "../packages/app/src/embedCasesNode.ts";

const documents = process.argv.slice(2);
if (documents.length === 0) throw new Error("Which documents? scripts/embed-cases.mts <Fixtures/markdown/name.md>…");
for (const document of documents) {
  const cases = await readEmbedCases(document);
  const out = document.replace(/\.md$/, ".cases.json");
  writeFileSync(out, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`${basename(out)}: ${cases.cases.length} cases`);
}
