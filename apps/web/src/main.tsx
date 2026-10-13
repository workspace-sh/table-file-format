import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter, for every platform without SF (see strict.css); fetched only where used.
import "@fontsource-variable/inter";
import "./strict.css";
import { App } from "./App";
import { EmbedTest } from "./EmbedTest";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    {/* Development only: table embeds, each case a document can hold (EmbedTest.tsx). */}
    {import.meta.env.DEV && location.hash === "#embed-test" ? <EmbedTest /> : <App />}
  </StrictMode>,
);
