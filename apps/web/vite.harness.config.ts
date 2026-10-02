import { defaultClientConditions, defineConfig } from "vite";

// The index harness (harness/harness.ts): a plain page, no React, so what it
// measures is the index and the browser. BIG_DIR holds big-<n>.table folders
// (scripts/big-table.mts) and is served as the site root.
export default defineConfig({
  root: "harness",
  publicDir: process.env.BIG_DIR ?? false,
  resolve: { conditions: ["source", ...defaultClientConditions] },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
  build: { outDir: "../dist-harness", emptyOutDir: true, target: "es2022" },
  preview: { port: 4175 },
});
