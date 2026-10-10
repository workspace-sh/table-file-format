import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "vite-plugin-babel";
// @ts-expect-error a plain script, shared with the other apps' builds
import { buildInfo } from "../../scripts/build-version.mjs";

export default defineConfig(() => ({
  // Where the built demo is served from: "/" locally, and
  // "/table-file-format/" on GitHub Pages (set by .github/workflows/pages.yml).
  base: process.env.PAGES_BASE ?? "/",
  resolve: {
    // Workspace packages from their TypeScript source (the "source"
    // export condition), as Metro does on mobile and desktop. Without
    // this, table-core resolved to its gitignored dist/, which only
    // `npm run core:build` refreshes — so after a pull, the web demo
    // built against stale core or failed outright.
    conditions: ["source", ...defaultClientConditions],
    extensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
  },
  plugins: [
    react({
      babel: {
        configFile: true,
      },
    }),
    babel(),
  ],
  // Which build this is, shown in the sidebar (docs/VERSIONING.md).
  define: { __TABLE_BUILD__: JSON.stringify(buildInfo()) },
  build: {
    outDir: "dist-web",
  },
}));
