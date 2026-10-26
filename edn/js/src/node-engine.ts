// The formula core, set for table-core in Node, as the apps set it as they start (#710):
// `node --import ../../edn/js/src/node-engine.ts --test …` runs a package's tests with it.
import { setFormulaEngine } from "../../../packages/core/src/workbook.ts";
import { loadEdn } from "./index.ts";

setFormulaEngine((await loadEdn()) as never);
