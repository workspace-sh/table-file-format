// EDN for Workspace on the web and in Node (Linux's app): the Rust core
// (edn/crates/core), natively in Node where a build for this machine is in
// native/, as WebAssembly everywhere else, behind one API. Load it once with
// `loadEdn`; reading and printing are then synchronous.
//
// A value crosses as a tree that loses nothing: a keyword and a string, a
// list and a vector, `1` and `1.0` all stay apart, and integers are strings,
// so one beyond 2^53 survives JavaScript's numbers.

import init, { canonical as wasmCanonical, formula as wasmFormula, read as wasmRead } from "../wasm/edn.js";

export type EdnValue =
  | { t: "nil" }
  | { t: "bool"; v: boolean }
  | { t: "str" | "char" | "int" | "float" | "decimal" | "sym" | "kw"; v: string }
  | { t: "list" | "vec" | "set"; v: EdnValue[] }
  | { t: "map"; v: [EdnValue, EdnValue][] }
  | { t: "tag"; tag: string; v: EdnValue };

/** A `.table` formula's expression: the shape `.table`'s evaluator takes (table-core's `Expr`). */
export type FormulaExpr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "nil" }
  | { kind: "field"; name: string }
  | { kind: "call"; fn: string; args: FormulaExpr[] };

/** Why a text couldn't be read, and where (lines and columns count from 1). */
export class EdnError extends Error {
  readonly line: number | null;
  readonly column: number | null;
  constructor(message: string, line: number | null, column: number | null) {
    super(line !== null && column !== null ? `${message} (line ${line}, column ${column})` : message);
    this.name = "EdnError";
    this.line = line;
    this.column = column;
  }
}

export interface Edn {
  /** One EDN value from `text`, or throws an EdnError. */
  read(text: string): EdnValue;
  /** `text`'s canonical form, or throws an EdnError. */
  canonical(text: string): string;
  /** A `.table` formula, read into the expression its evaluator takes, or throws an EdnError. */
  formula(text: string): FormulaExpr;
  /** Which binding is answering: the native library, or WebAssembly. */
  readonly binding: "native" | "wasm";
}

type Calls = { read(text: string): string; canonical(text: string): string; formula(text: string): string };

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
      if (native) return api(native, "native");
      if (options.binding === "native") throw new Error("no native EDN library for this machine (edn/js/build-native.sh builds one)");
      const url = new URL("../wasm/edn_bg.wasm", import.meta.url);
      await init({ module_or_path: options.wasm ?? (isNode() ? await readNodeFile(url) : url) });
      return api({ read: wasmRead, canonical: wasmCanonical, formula: wasmFormula }, "wasm");
    })();
    loading.set(key, found);
  }
  return found;
}

const api = (c: Calls, binding: "native" | "wasm"): Edn => ({
  read: (text) => JSON.parse(call(c.read, text)) as EdnValue,
  canonical: (text) => call(c.canonical, text),
  formula: (text) => JSON.parse(call(c.formula, text)) as FormulaExpr,
  binding,
});

/** The native library built for this machine (native/edn.<platform>-<arch>.node), or null when there isn't one. */
async function loadNative(): Promise<Calls | null> {
  const { createRequire } = await import("node:module");
  const { existsSync } = await import("node:fs");
  const file = new URL(`../native/edn.${process.platform}-${process.arch}.node`, import.meta.url);
  if (!existsSync(file)) return null;
  return createRequire(import.meta.url)(file.pathname) as Calls;
}

function call(fn: (text: string) => string, text: string): string {
  try {
    return fn(text);
  } catch (thrown) {
    // WebAssembly throws the JSON itself; the native library throws an Error carrying it.
    const json = typeof thrown === "string" ? thrown : thrown instanceof Error && thrown.message.startsWith("{") ? thrown.message : null;
    if (json !== null) {
      const e = JSON.parse(json) as { message: string; line: number | null; column: number | null };
      throw new EdnError(e.message, e.line, e.column);
    }
    throw thrown;
  }
}

const isNode = (): boolean => typeof process !== "undefined" && !!process.versions?.node;

async function readNodeFile(url: URL): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(url));
}
