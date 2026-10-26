// EDN for Workspace on the web and in Node (Linux's app): the Rust core
// (edn/crates/core), natively in Node where a build for this machine is in
// native/, as WebAssembly everywhere else, behind one API. Load it once with
// `loadEdn`; reading and printing are then synchronous.
//
// A value crosses as a tree that loses nothing: a keyword and a string, a
// list and a vector, `1` and `1.0` all stay apart, and integers are strings,
// so one beyond 2^53 survives JavaScript's numbers.

import init, { canonical as wasmCanonical, computeWorkbook as wasmComputeWorkbook, formula as wasmFormula, read as wasmRead } from "../wasm/edn.js";
import { engineFrom, type Calls, type Edn } from "./api.ts";

export * from "./api.ts";

const loading = new Map<string, Promise<Edn>>();

/**
 * The engine, loaded once. In a browser the WebAssembly is fetched beside
 * this module; in Node it's read from disk. `wasm` gives it another way
 * (bytes, a URL, a Response).
 */
export function loadEdn(options: { wasm?: BufferSource | URL | Response; binding?: "native" | "wasm" } = {}): Promise<Edn> {
  const key = options.binding ?? "auto";
  let found = loading.get(key);
  if (!found) {
    found = (async () => {
      const native = options.binding !== "wasm" && isNode() ? await loadNative() : null;
      if (native) return engineFrom(native, "native");
      if (options.binding === "native") throw new Error("no native EDN library for this machine (edn/js/build-native.sh builds one)");
      const url = new URL("../wasm/edn_bg.wasm", import.meta.url);
      await init({ module_or_path: options.wasm ?? (isNode() ? await readNodeFile(url) : url) });
      return engineFrom({ read: wasmRead, canonical: wasmCanonical, formula: wasmFormula, computeWorkbook: wasmComputeWorkbook }, "wasm");
    })();
    loading.set(key, found);
  }
  return found;
}


/** The native library built for this machine (native/edn.<platform>-<arch>.node), or null when there isn't one. */
async function loadNative(): Promise<Calls | null> {
  const { createRequire } = await import("node:module");
  const { existsSync } = await import("node:fs");
  // Beside this package's source (../native), or beside a bundle built from it (./native).
  const name = `edn.${process.platform}-${process.arch}.node`;
  // Through a variable: a web bundler copies what `new URL(…, import.meta.url)` names, and this is no web's.
  const here = import.meta.url;
  const file = [new URL(`../native/${name}`, here), new URL(`./native/${name}`, here)].find((f) => existsSync(f));
  if (!file) return null;
  return createRequire(import.meta.url)(file.pathname) as Calls;
}


const isNode = (): boolean => typeof process !== "undefined" && !!process.versions?.node;

async function readNodeFile(url: URL): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  return new Uint8Array(await readFile(fileURLToPath(url.href)));
}
