import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter, for every platform without SF (see strict.css); fetched only where used.
import "@fontsource-variable/inter";
import "./strict.css";
import { setFormulaEngine } from "@workspace.sh/table-core";
import { loadEdn } from "@workspace.sh/edn";
import { App } from "./App";
import { EmbedTest } from "./EmbedTest";

// Formulas are worked out by the EDN core, as WebAssembly, once it's loaded (#638); until then, and if it
// can't load, by `.table`'s own workbook, which gives the same results.
void loadEdn().then(
  (edn) => setFormulaEngine(edn),
  (e: unknown) => console.warn(`formulas: the workbook's own, not the EDN core: ${String(e)}`),
);

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    {/* Development only: table embeds, each case a document can hold (EmbedTest.tsx). */}
    {import.meta.env.DEV && location.hash === "#embed-test" ? <EmbedTest /> : <App />}
  </StrictMode>,
);
