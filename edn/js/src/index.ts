// EDN for Workspace on the web and in Node (Linux's app): the Rust core
// (edn/crates/core), natively in Node where a build for this machine is in
// native/, as WebAssembly everywhere else, behind one API. Load it once with
// `loadEdn`; reading and printing are then synchronous.
//
// A value crosses as a tree that loses nothing: a keyword and a string, a
// list and a vector, `1` and `1.0` all stay apart, and integers are strings,
// so one beyond 2^53 survives JavaScript's numbers.

import init, { canonical as wasmCanonical, evaluateColumn as wasmEvaluateColumn, formula as wasmFormula, read as wasmRead } from "../wasm/edn.js";

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
  /**
   * A `.table` formula over whole columns, inside the core: the same results
   * as `.table`'s evaluator, row by row. `columns` holds each field the
   * formula reads (fieldsOf), one value per row. Throws an EdnError for a
   * formula the core leaves to the host (it follows a relation or reads a
   * Sheet place); use `.table`'s own evaluator for those.
   */
  evaluateColumn(formula: string, columns: Record<string, readonly unknown[]>, rows: number): FormulaResult[];
  /** Which binding is answering: the native library, or WebAssembly. */
  readonly binding: "native" | "wasm";
}

/** A formula's result: `.table`'s `Value`, with an error as its code and message. */
export type FormulaResult = number | string | boolean | undefined | { code: string; message: string } | FormulaResult[];

type ColumnResults = { kinds: Uint8Array; numbers: Float64Array; extra: string };

type Calls = {
  read(text: string): string;
  canonical(text: string): string;
  formula(text: string): string;
  evaluateColumn(formula: string, numberNames: string[], numbers: Float64Array, json: string, rows: number): ColumnResults;
};

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
      return api({ read: wasmRead, canonical: wasmCanonical, formula: wasmFormula, evaluateColumn: wasmEvaluateColumn }, "wasm");
    })();
    loading.set(key, found);
  }
  return found;
}

const api = (c: Calls, binding: "native" | "wasm"): Edn => ({
  read: (text) => JSON.parse(call(c.read, text)) as EdnValue,
  canonical: (text) => call(c.canonical, text),
  formula: (text) => JSON.parse(call(c.formula, text)) as FormulaExpr,
  evaluateColumn: (formula, columns, rows) => {
    const numberNames: string[] = [];
    const parts: Float64Array[] = [];
    const json: Record<string, unknown[]> = {};
    for (const [name, cells] of Object.entries(columns)) {
      const numbers = numbersOnly(cells, rows);
      if (numbers) {
        numberNames.push(name);
        parts.push(numbers);
      } else json[name] = Array.from({ length: rows }, (_, i) => (cells[i] === undefined ? null : cells[i]));
    }
    const numbers = new Float64Array(numberNames.length * rows);
    parts.forEach((p, i) => numbers.set(p, i * rows));
    const out = callWith(() => c.evaluateColumn(formula, numberNames, numbers, Object.keys(json).length > 0 ? JSON.stringify(json) : "", rows));
    return decode(out, rows);
  },
  binding,
});

/** A column's cells as numbers (`NaN` for an empty cell), or null when any cell isn't a number or empty. */
function numbersOnly(cells: readonly unknown[], rows: number): Float64Array | null {
  const out = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    const v = cells[i];
    if (typeof v === "number") out[i] = v;
    else if (v === undefined || v === null || v === "") out[i] = NaN;
    else return null;
  }
  return out;
}

function decode(r: ColumnResults, rows: number): FormulaResult[] {
  const extra = JSON.parse(r.extra) as unknown[];
  const out: FormulaResult[] = new Array(rows);
  let next = 0;
  for (let i = 0; i < rows; i++) {
    const k = r.kinds[i];
    out[i] = k === 1 ? r.numbers[i] : k === 2 ? true : k === 3 ? false : k === 4 ? fromJson(extra[next++]) : undefined;
  }
  return out;
}

const fromJson = (v: unknown): FormulaResult =>
  v === null ? undefined : Array.isArray(v) ? v.map(fromJson) : (v as FormulaResult);

/** The fields a formula reads: its bare words and `(field "…")`s, and the columns its `(values "…")` read. */
export function fieldsOf(expr: FormulaExpr): string[] {
  const out = new Set<string>();
  const walk = (e: FormulaExpr): void => {
    if (e.kind === "field") out.add(e.name);
    else if (e.kind === "call") {
      if ((e.fn === "field" || e.fn === "values") && e.args[0]?.kind === "string") out.add(e.args[0].value);
      e.args.forEach(walk);
    }
  };
  walk(expr);
  return [...out];
}

/** The native library built for this machine (native/edn.<platform>-<arch>.node), or null when there isn't one. */
async function loadNative(): Promise<Calls | null> {
  const { createRequire } = await import("node:module");
  const { existsSync } = await import("node:fs");
  const file = new URL(`../native/edn.${process.platform}-${process.arch}.node`, import.meta.url);
  if (!existsSync(file)) return null;
  return createRequire(import.meta.url)(file.pathname) as Calls;
}

function call(fn: (text: string) => string, text: string): string {
  return callWith(() => fn(text));
}

function callWith<T>(run: () => T): T {
  try {
    return run();
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
