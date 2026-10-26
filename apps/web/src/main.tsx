import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter, for every platform without SF (see strict.css); fetched only where used.
import "@fontsource-variable/inter";
import "./strict.css";
import { setFormulaEngine } from "@workspace.sh/table-core";
import { loadEdn } from "@workspace.sh/edn";
import { App } from "./App";
import { EmbedTest } from "./EmbedTest";

// Formulas are worked out by the EDN core, as WebAssembly (#638, #710): loaded before the first draw, so
// no table is drawn with its formulas still empty. One that can't load leaves them empty, and says so.
const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

const draw = () =>
  createRoot(container).render(
    <StrictMode>
      {/* Development only: table embeds, each case a document can hold (EmbedTest.tsx). */}
      {import.meta.env.DEV && location.hash === "#embed-test" ? <EmbedTest /> : <App />}
    </StrictMode>,
  );

void loadEdn()
  .then(
    (edn) => setFormulaEngine(edn),
    (e: unknown) => console.warn(`formulas aren't worked out, the EDN core didn't load: ${String(e)}`),
  )
  .then(draw);
