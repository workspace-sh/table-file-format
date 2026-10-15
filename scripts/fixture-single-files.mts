// Any folder's .tables as single files (SPEC section 13, D49, D50):
//
//   node --conditions=source --import tsx scripts/fixture-single-files.mts <folder holding .table folders>
//
// Writes single-file/<name>.table for each <name>.table folder in it (a folder and a file can't share a
// name in one folder), packed by single-file.mts: the same folder always gives the same bytes, and each
// says it unzips to its folder and opens as the folder reads. For this repository's own examples, use
// `npm run fixtures:export`, which writes the folders and their single files together.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packFolder } from "./single-file.mts";

const dir = process.argv[2]!;
const names = readdirSync(dir).filter((n) => n.endsWith(".table") && statSync(join(dir, n)).isDirectory()).map((n) => n.slice(0, -".table".length)).sort();
for (const name of names) {
  const packed = await packFolder(join(dir, `${name}.table`), name);
  mkdirSync(join(dir, "single-file"), { recursive: true });
  writeFileSync(join(dir, "single-file", `${name}.table`), packed.bytes);
  console.log(
    `single-file/${name}.table ${packed.bytes.length} bytes, ${packed.files} files, unzips to the folder: ${packed.unzipsToFolder}, opens as the folder reads: ${packed.opensAsFolder}, sha256 ${packed.sha256}`,
  );
}
