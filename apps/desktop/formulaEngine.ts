// Formulas are worked out by the EDN core (#638, #710), through the app's
// JSI module (edn/js/apple). A build without it (edn/js/build-apple.sh not
// run) works no formula out, and says so.

import { NativeModules } from "react-native";
import { setFormulaEngine } from "@workspace.sh/table-core";
import { jsiEdn } from "@workspace.sh/edn/jsi";

// Asking for the module is what installs its calls on the runtime.
void NativeModules.WorkspaceEdn;
const edn = jsiEdn();
if (edn) setFormulaEngine(edn);
else console.warn("formulas aren't worked out: this build has no WorkspaceEdn module (run edn/js/build-apple.sh)");
