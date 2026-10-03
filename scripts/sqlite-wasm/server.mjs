// Serves the SQLite WASM spike and a big table's rows.ndjson.
//
//   npm i --no-save @sqlite.org/sqlite-wasm
//   npx tsx scripts/big-table.mts 1000000 /tmp/big
//   node scripts/sqlite-wasm/server.mjs /tmp/big
//
// Then open http://localhost:5300/ and, in the console:
//   await run("1000000", "opfs-fresh")   // build the index, then time queries
//   await run("1000000", "opfs")         // reopen it

import { createReadStream, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = resolve(process.argv[2] ?? ".");
const wasm = resolve(here, "../../node_modules/@sqlite.org/sqlite-wasm/dist");
const types = { ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://x");
  let file;
  if (pathname.startsWith("/data/")) {
    const dir = `${data}/big-${pathname.slice(6).replace(/\W/g, "")}.table/tables`;
    file = `${dir}/${readdirSync(dir)[0]}/rows.ndjson`;
  } else if (pathname.startsWith("/sqlite/")) file = resolve(wasm, pathname.slice(8).replace(/\.\./g, ""));
  else file = resolve(here, pathname === "/" ? "index.html" : pathname.slice(1).replace(/\.\./g, ""));
  try {
    const size = statSync(file).size;
    res.setHeader("content-type", types[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
    res.setHeader("content-length", size);
    createReadStream(file).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(5300, () => console.log("http://localhost:5300/"));
