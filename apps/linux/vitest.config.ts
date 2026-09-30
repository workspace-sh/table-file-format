import gtkx from "@gtkx/cli/vitest-plugin";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vite.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    plugins: [gtkx()],
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      bail: 1,
      setupFiles: ["tests/setup.ts"],
    },
  }),
);
