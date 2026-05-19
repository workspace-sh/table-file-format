import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./strict.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
