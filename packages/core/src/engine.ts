// The engine: the Rust core (edn/), injected by the app as it starts (`setFormulaEngine`) and by
// the tests (edn/js/src/node-engine.ts). This package never imports a binding itself: the web
// loads WebAssembly, Linux a native add-on, the Apple and Android apps a JSI module, and each
// hands the result here.
//
// A module that has moved to Rust asks it through `call` (table-file-format#867): an operation's
// name and its input in, its answer out, as JSON, in the shape of workspace-protocol's actions
// engine. Operations asked once per cell or row use `check` or `numberOf` instead: a yes or no,
// or a number, about one text, which cross with no JSON at several times the speed.

import type { FormulaEngine } from "./workbook.js";

let engine: FormulaEngine | null = null;

/** The engine from now on; null, none (formulas stay empty, and say why; `call` throws). */
export function setFormulaEngine(next: FormulaEngine | null): void {
  engine = next;
}

/** Whether an engine is set, so formulas are worked out. */
export function formulaEngineSet(): boolean {
  return engine !== null;
}

/** The engine, or null before the app has set one. */
export function formulaEngine(): FormulaEngine | null {
  return engine;
}

function loaded(op: string): FormulaEngine {
  if (!engine) throw new Error(`.table's engine isn't loaded, and ${op} needs it: an app sets it with setFormulaEngine as it starts`);
  return engine;
}

/** The engine's operation `op` (`module.function`) asked with `input`, and its answer. A mistake is thrown. */
export function call<T>(op: string, input: Record<string, unknown>): T {
  const answer = JSON.parse(loaded(op).call(op, JSON.stringify(input))) as { value: T } | { error: string };
  if ("error" in answer) throw new Error(`${op}: ${answer.error}`);
  return answer.value;
}

/** The engine's check `op` of `text`. */
export function check(op: string, text: string): boolean {
  const answer = loaded(op).callCheck(op, text);
  if (answer == null) throw new Error(`${op} isn't a check the engine has`);
  return answer;
}

/** The number the engine's `op` gives for `text`. */
export function numberOf(op: string, text: string): number {
  const answer = loaded(op).callNumber(op, text);
  if (answer == null) throw new Error(`${op} isn't a number the engine has`);
  return answer;
}
