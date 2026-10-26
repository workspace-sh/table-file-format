// Formulas are worked out by the EDN core (#638), through the app's JSI
// module (edn/js/apple), where the app was built with it; otherwise by
// `.table`'s own workbook, which gives the same results.

import { NativeModules } from "react-native";
import { setFormulaEngine } from "@workspace.sh/table-core";
import { jsiEdn } from "@workspace.sh/edn/jsi";

// Asking for the module is what installs its calls on the runtime.
void NativeModules.WorkspaceEdn;
const edn = jsiEdn();
if (edn) setFormulaEngine(edn);
else console.warn("formulas: the workbook's own, not the EDN core (this build has no WorkspaceEdn module)");
