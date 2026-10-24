// EDN for Workspace on the web and in Node (Linux's app): the Rust core
// (edn/crates/core), natively in Node where a build for this machine is in
// native/, as WebAssembly everywhere else, behind one API. Load it once with
// `loadEdn`; reading and printing are then synchronous.
//
// A value crosses as a tree that loses nothing: a keyword and a string, a
// list and a vector, `1` and `1.0` all stay apart, and integers are strings,
// so one beyond 2^53 survives JavaScript's numbers.

import init, { canonical as wasmCanonical, computeWorkbook as wasmComputeWorkbook, formula as wasmFormula, read as wasmRead } from "../wasm/edn.js";

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
   * Every formula of a bundle's tables, computed inside the core: the same
   * results as `.table`'s workbook (computeRows), field by field and row by
   * row: fields' formulas, cells' own (D52), loops worked out by iteration
   * (D60), and the clock and chance (D55), read at `now` (absent: the time
   * it's asked) with chance drawn from `seed`. A table whose formulas read a
   * Sheet view's places is the host's, and so is every table related to it:
   * they come back as "host", for `.table`'s own workbook to compute.
   */
  computeTables(tables: Record<string, TableIn>, clock?: { now?: Date; seed?: number }): Record<string, Record<string, FormulaResult[]> | "host">;
  /** Which binding is answering: the native library, or WebAssembly. */
  readonly binding: "native" | "wasm";
}

/** A formula's result: `.table`'s `Value`, with an error as its code and message. */
export type FormulaResult = number | string | boolean | undefined | { code: string; message: string } | FormulaResult[];

type ColumnResults = { kinds: Uint8Array; numbers: Float64Array; extra: string; index: string };

/** A table as `computeTables` takes it: `.table`'s schema fields (only what's read) and rows. */
export interface TableIn {
  schema: { fields: { name: string; type?: string; computed?: { expr: string; dialect: string }; relation?: { table: string; cardinality?: string } }[] };
  rows: readonly ({ id: string } & Record<string, unknown>)[];
  /** Its cells' own formulas and notes (D52, D57). */
  cells?: readonly { id: string; field: string; expr?: string; dialect?: string }[];
  /** Its meta: how it works its loops out by iteration (D60), if it does. */
  meta?: { iteration?: { max: number; change: number } | unknown };
}

const two = (n: number) => String(n).padStart(2, "0");

type Calls = {
  read(text: string): string;
  canonical(text: string): string;
  formula(text: string): string;
  computeWorkbook(json: string, numbers: Float64Array): ColumnResults;
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
      return api({ read: wasmRead, canonical: wasmCanonical, formula: wasmFormula, computeWorkbook: wasmComputeWorkbook }, "wasm");
    })();
    loading.set(key, found);
  }
  return found;
}

const api = (c: Calls, binding: "native" | "wasm"): Edn => ({
  read: (text) => JSON.parse(call(c.read, text)) as EdnValue,
  canonical: (text) => call(c.canonical, text),
  formula: (text) => JSON.parse(call(c.formula, text)) as FormulaExpr,
  computeTables: (tables, clock = {}) => {
    const parts: Float64Array[] = [];
    // One moment for the whole computation (D55): the reader's own date, and the instant in UTC.
    const now = clock.now ?? new Date();
    const json = {
      clock: {
        today: `${String(now.getFullYear()).padStart(4, "0")}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
        now: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
        seed: clock.seed ?? Math.floor(Math.random() * 2 ** 53),
      },
      tables: Object.entries(tables).map(([name, t]) => {
        const iteration = t.meta?.iteration as { max?: unknown; change?: unknown } | undefined;
        return {
          name,
          ...(iteration && typeof iteration.max === "number" ? { iteration: { max: iteration.max, change: typeof iteration.change === "number" ? iteration.change : 0 } } : {}),
          ids: t.rows.map((r) => r.id),
          fields: t.schema.fields.map((f) => {
            const kind = { type: f.type ?? "string", ...(f.relation?.cardinality === "many" ? { many: true } : {}) };
            if (f.computed) return { name: f.name, ...kind, formula: f.computed.dialect === "table-expr-v1" ? f.computed.expr : null };
            const cells = t.rows.map((r) => r[f.name]);
            const numbers = numbersOnly(cells, cells.length);
            const stored = numbers ? (parts.push(numbers), { numbers: parts.length - 1 }) : { values: cells.map((v) => (v === undefined ? null : v)) };
            return { name: f.name, ...kind, ...(f.relation ? { relation: f.relation.table } : {}), ...stored };
          }),
          // Every line with a formula, as read (a note alone is none, D57): which apply is the core's to say.
          ...(t.cells?.some((c) => c.expr !== undefined)
            ? { cells: t.cells.filter((c) => c.expr !== undefined).map((c) => ({ id: c.id, field: c.field, formula: (c.dialect ?? "table-expr-v1") === "table-expr-v1" ? c.expr : null })) }
            : {}),
        };
      }),
    };
    const numbers = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      numbers.set(p, at);
      at += p.length;
    }
    const r = callWith(() => c.computeWorkbook(JSON.stringify(json), numbers));
    const all = decode(r, r.kinds.length);
    const index = JSON.parse(r.index) as Record<string, { host: true } | { fields: Record<string, [number, number]> }>;
    const out: Record<string, Record<string, FormulaResult[]> | "host"> = {};
    for (const [name, entry] of Object.entries(index)) {
      if ("host" in entry) out[name] = "host";
      else out[name] = Object.fromEntries(Object.entries(entry.fields).map(([f, [start, rows]]) => [f, all.slice(start, start + rows)]));
    }
    return out;
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
  // Each read once: through WebAssembly, every read of `kinds` or `numbers` copies the whole array.
  const kinds = r.kinds;
  const numbers = r.numbers;
  const extra = JSON.parse(r.extra) as unknown[];
  const out: FormulaResult[] = new Array(rows);
  let next = 0;
  for (let i = 0; i < rows; i++) {
    const k = kinds[i];
    out[i] = k === 1 ? numbers[i] : k === 2 ? true : k === 3 ? false : k === 4 ? fromJson(extra[next++]) : undefined;
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
