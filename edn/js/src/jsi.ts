// The core in the iOS and Mac apps: their JSI module (edn/apple) puts the
// C binding's four calls on `globalThis.__workspaceEdn` before the app's
// JavaScript runs. Nothing here loads WebAssembly or reads `import.meta`,
// which React Native's Hermes has neither of.

import { engineFrom, type Calls, type Edn } from "./api.ts";

export * from "./api.ts";

/** The engine the app's JSI module installed, or null when the app has none (its formulas stay with table-core's own evaluator). */
export function jsiEdn(): Edn | null {
  const calls = (globalThis as { __workspaceEdn?: Calls }).__workspaceEdn;
  return calls ? engineFrom(calls, "native") : null;
}
