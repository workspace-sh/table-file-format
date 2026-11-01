// Formulas are worked out by the EDN core (#638, #710), through the app's
// JSI module, WorkspaceEdn (edn/js/apple). Imported once, before anything
// reads a table, by every app on React Native (the .table apps and
// Workspace). A build without the module works no formula out, and says so.

import { NativeModules } from "react-native";
import { jsiEdn } from "@workspace.sh/edn/jsi";
import { setFormulaEngine } from "@workspace.sh/table-core";

// Asking for the module is what installs its calls on the runtime.
void NativeModules.WorkspaceEdn;
const edn = jsiEdn();
if (edn) setFormulaEngine(edn);
else console.warn("formulas aren't worked out: this build has no WorkspaceEdn module (run edn/js/build-apple.sh)");
