// A large table's rows checked as its index is made (table-file-format#867, step 2c): the engine
// is given each rows file's pieces as the build reads them, checks a file's rows when it ends and
// lets them go, and at the end says what problemsOf would find of them (an IndexCheck), to be kept
// with the index. A check never stops a build: whatever goes wrong, the index is made, the table
// reads as not checked, and why is said.

import { call, callBytes, formulaEngineSet } from "./engine.js";
import { checkStamp, type IndexCheck } from "./problems.js";
import { enumValues, type ParsedTable } from "./types.js";

/** A check under way. Each call is safe to make whatever happened before it. */
export interface RowsCheck {
  /** A rows file begins. */
  beginFile(name: string): void;
  /** A piece of the rows file being read, as the build reads it. */
  piece(bytes: Uint8Array): void;
  /** The rows file being read has ended. */
  endFile(name: string): void;
  /** What was found, or null (and why, in `failed`) when the check couldn't be made. */
  finish(): IndexCheck | null;
  /** Lets the engine drop the check, if it's still under way: a build that stopped part-way. */
  free(): void;
  /** Why the check couldn't be made, once it couldn't. */
  readonly failed: string | undefined;
}

/** How many problems a check says in full: as many as a list shows at first. */
export const CHECK_WINDOW = 200;

/**
 * A check of a table's rows, or null when there's none to make: no engine, or a table the engine
 * can't promise memory's answer for (cells with their own formulas, a `pattern`).
 * `attachments`: the files of its `attachments/`, when they're known.
 */
export function startCheck(table: Pick<ParsedTable, "schema" | "bodies" | "cells">, options: { attachments?: readonly string[]; /** Bytes of whole lines checked at a time: for tests. */ batch?: number } = {}): RowsCheck | null {
  if (!formulaEngineSet()) return null;
  if (table.cells?.some((c) => c.expr !== undefined)) return null;
  const stamp = checkStamp(table);
  let handle: number | null;
  try {
    handle = call<number | null>("check.new", {
      schema: { ...table.schema, fields: table.schema.fields.map((f) => ({ ...f, choices: enumValues(f) })) },
      bodies: Object.keys(table.bodies ?? {}),
      ...(options.attachments ? { attachments: options.attachments } : {}),
      window: CHECK_WINDOW,
      ...(options.batch ? { batch: options.batch } : {}),
    });
  } catch {
    // An engine without checks (an older binary): there's none to make.
    return null;
  }
  if (handle === null) return null;
  let failed: string | undefined;
  let done = false;
  const free = () => {
    if (done) return;
    done = true;
    try {
      call("check.free", { handle });
    } catch {
      // Gone already.
    }
  };
  const fail = (e: unknown) => {
    failed = e instanceof Error ? e.message : String(e);
    free();
  };
  return {
    get failed() {
      return failed;
    },
    beginFile(name) {
      if (failed !== undefined || done) return;
      try {
        call("check.begin", { handle, file: name });
      } catch (e) {
        fail(e);
      }
    },
    piece(bytes) {
      if (failed !== undefined || done || bytes.length === 0) return;
      try {
        callBytes("check.piece", { handle }, bytes);
      } catch (e) {
        fail(e);
      }
    },
    endFile(name) {
      if (failed !== undefined || done) return;
      try {
        call("check.file", { handle, file: name });
      } catch (e) {
        fail(e);
      }
    },
    free,
    finish() {
      if (failed !== undefined || done) return null;
      try {
        done = true;
        const found = call<Omit<IndexCheck, "stamp" | "attachments">>("check.finish", { handle });
        return {
          ...found,
          stamp,
          ...(options.attachments ? { attachments: [...options.attachments] } : {}),
        };
      } catch (e) {
        fail(e);
        return null;
      }
    },
  };
}

/** The engine's version of what a check finds, or null without an engine that checks. */
export function checkRules(): number | null {
  if (!formulaEngineSet()) return null;
  try {
    return call<number>("check.rules", {});
  } catch {
    return null;
  }
}
