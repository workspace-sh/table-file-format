import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "vite-plugin-babel";

export default defineConfig(() => ({
  resolve: {
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
