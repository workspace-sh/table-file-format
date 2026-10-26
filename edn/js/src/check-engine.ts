// Every formula `.table`'s workbook computes, computed by the core as well and compared, a difference
// thrown: `node --import ./edn/js/src/check-engine.ts --test …` runs a package's tests this way (#638).
import { setFormulaEngine } from "../../../packages/core/src/workbook.ts";
import { loadEdn } from "./index.ts";

setFormulaEngine((await loadEdn()) as never, { check: true });

process.on("exit", async () => {
  const { engineAnswered } = await import("../../../packages/core/src/workbook.ts");
  process.stderr.write(`check-engine: the core answered ${engineAnswered} tables\n`);
});
