import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "vite-plugin-babel";

export default defineConfig(() => ({
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
  build: {
    outDir: "dist-web",
  },
}));
