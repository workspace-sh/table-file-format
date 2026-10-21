// EDN for Workspace on the web and in Node (Linux's app): the Rust core
// (edn/crates/core) as WebAssembly, behind one API. Load it once with
// `loadEdn`; reading and printing are then synchronous.
//
// A value crosses as a tree that loses nothing: a keyword and a string, a
// list and a vector, `1` and `1.0` all stay apart, and integers are strings,
// so one beyond 2^53 survives JavaScript's numbers.

import init, { canonical as wasmCanonical, read as wasmRead } from "../wasm/edn.js";

export type EdnValue =
  | { t: "nil" }
  | { t: "bool"; v: boolean }
  | { t: "str" | "char" | "int" | "float" | "decimal" | "sym" | "kw"; v: string }
  | { t: "list" | "vec" | "set"; v: EdnValue[] }
  | { t: "map"; v: [EdnValue, EdnValue][] }
  | { t: "tag"; tag: string; v: EdnValue };

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
}

let loading: Promise<Edn> | undefined;

/**
 * The engine, loaded once. In a browser the WebAssembly is fetched beside
 * this module; in Node it's read from disk. `wasm` gives it another way
 * (bytes, a URL, a Response).
 */
export function loadEdn(wasm?: BufferSource | URL | Response): Promise<Edn> {
  loading ??= (async () => {
    const url = new URL("../wasm/edn_bg.wasm", import.meta.url);
    const source = wasm ?? (isNode() ? await readNodeFile(url) : url);
    await init({ module_or_path: source });
    return { read: (text) => JSON.parse(call(wasmRead, text)) as EdnValue, canonical: (text) => call(wasmCanonical, text) };
  })();
  return loading;
}

function call(fn: (text: string) => string, text: string): string {
  try {
    return fn(text);
  } catch (thrown) {
    if (typeof thrown === "string") {
      const e = JSON.parse(thrown) as { message: string; line: number | null; column: number | null };
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
