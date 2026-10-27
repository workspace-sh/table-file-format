// The example tables, from fixtures/ (a link into the workspace-fixtures submodule, the only place
// one is edited), written wherever a test needs them: a device's documents, a folder of one's own
// (#592), or workspace-fixtures itself, in place, for its single files and CHECKSUMS.
//
//   npm run fixtures:export -- <dir>           write them
//   npm run fixtures:export -- <dir> --check   fail, naming each file, if <dir> doesn't hold them as they are
//
// Writes into <dir>:
//   <name>.table/              each example as a folder, byte for byte
//   single-file/<name>.table   each as a single file (single-file.mts): the same bytes every time
//   CHECKSUMS                  sha256 of every file above, and the commit they came from
// Each example's folder is replaced whole, so a file removed from an example goes; in place (<dir> is
// fixtures/ itself) the folders are the source and are left alone. Nothing else in <dir> is touched. The large tables are scripts/big-table.mts's, made where they're needed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { folderFiles, packFolder } from "./single-file.mts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: npm run fixtures:export -- <dir> [--check]");
  process.exit(1);
}

const root = join(import.meta.dirname, "..");
const source = realpathSync(join(root, "fixtures"));
// Writing into fixtures/ itself: its folders are what's read, so they're never removed or rewritten.
const inPlace = existsSync(dir) && realpathSync(dir) === source;
const names = readdirSync(source)
  .filter((n) => n.endsWith(".table") && statSync(join(source, n)).isDirectory() && existsSync(join(source, n, "meta.json")))
  .map((n) => n.slice(0, -".table".length))
  .sort();

// What <dir> should hold, path by path.
const want = new Map<string, Uint8Array>();
for (const name of names) {
  const folder = join(source, `${name}.table`);
  for (const p of folderFiles(folder)) want.set(`${name}.table/${p}`, new Uint8Array(readFileSync(join(folder, p))));
  const packed = await packFolder(folder, name);
  if (!packed.unzipsToFolder || !packed.opensAsFolder) {
    console.error(`single-file/${name}.table doesn't read back as its folder (unzips: ${packed.unzipsToFolder}, opens: ${packed.opensAsFolder})`);
    process.exit(1);
  }
  want.set(`single-file/${name}.table`, packed.bytes);
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// The commit, so a copy says what it's a copy of; checked by the files' sums, not by it.
const commit = execFileSync("git", ["-C", source, "log", "-1", "--format=%h %cs", "--", "."], { encoding: "utf8" }).trim();
const sums = [...want].map(([p, b]) => `${sha(b)}  ${p}`).join("\n");
const checksums = `# The example tables from workspace-sh/workspace-fixtures Fixtures/table (${commit}), written by table-file-format's npm run fixtures:export.\n${sums}\n`;

if (check) {
  const differ: string[] = [];
  for (const [p, bytes] of want) {
    const at = join(dir, p);
    if (!existsSync(at)) differ.push(`missing   ${p}`);
    else if (Buffer.compare(readFileSync(at), bytes) !== 0) differ.push(`different ${p}`);
  }
  // A file in an example's folder that the example no longer has.
  for (const name of names) {
    const folder = join(dir, `${name}.table`);
    if (!existsSync(folder)) continue;
    for (const p of folderFiles(folder)) if (!want.has(`${name}.table/${p}`)) differ.push(`extra     ${name}.table/${p}`);
  }
  const listed = existsSync(join(dir, "CHECKSUMS")) ? readFileSync(join(dir, "CHECKSUMS"), "utf8").split("\n").slice(1).join("\n") : "";
  if (listed !== `${sums}\n`) differ.push("different CHECKSUMS");
  if (differ.length) {
    console.error(`${dir} doesn't hold the examples as fixtures/ has them. Run: npm run fixtures:export -- ${dir}\n${differ.join("\n")}`);
    process.exit(1);
  }
  console.log(`${dir} holds the ${names.length} examples as fixtures/ has them (${want.size} files).`);
} else {
  if (!inPlace) for (const name of names) rmSync(join(dir, `${name}.table`), { recursive: true, force: true });
  for (const [p, bytes] of want) {
    if (inPlace && !p.startsWith("single-file/")) continue;
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), bytes);
  }
  writeFileSync(join(dir, "CHECKSUMS"), checksums);
  for (const name of names) console.log(`${name}.table, and single-file/${name}.table (sha256 ${sha(want.get(`single-file/${name}.table`)!).slice(0, 12)}…)`);
  console.log(`${want.size} files written to ${dir}, from fixtures/ at ${commit}.`);
}
