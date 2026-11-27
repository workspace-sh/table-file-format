// The engine, set for table-core as node-engine.ts sets it, with tables' rows read through it
// (table-file-format#867, step 1): `node --import ../../edn/js/src/node-engine-rows.ts --test …`
// runs a package's tests that way.
import { setFormulaEngine, setRowsThroughEngine } from "../../../packages/core/src/engine.ts";
import { loadEdn } from "./index.ts";

setFormulaEngine((await loadEdn()) as never);
setRowsThroughEngine(true);
