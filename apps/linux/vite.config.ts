import { fileURLToPath } from "node:url";
import { defaultServerConditions, defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The app is not a member of the root npm workspace (a Mac running
 * `npm install` at the root must not fetch GTK bindings), so the two
 * packages it renders are reached by alias, from their TypeScript source,
 * as the web demo reaches them through its "source" condition.
 *
 * `dedupe` makes a bare import inside those packages (react, @gtkx/react,
 * fflate, nanoid) resolve from this app's node_modules. Without it they
 * resolve beside the package's own real path, where nothing is installed,
 * or worse, where a second React is.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@workspace\.sh\/table-core$/, replacement: here("../../packages/core/src/index.ts") },
      { find: /^@workspace\.sh\/table-core\/(parser|writer|archive|io|node-fs)$/, replacement: here("../../packages/core/src/$1.ts") },
      { find: /^@workspace\.sh\/table-ui\/shared$/, replacement: here("../../packages/ui/src/shared.ts") },
      { find: /^@workspace\.sh\/table-app$/, replacement: here("../../packages/app/src/index.ts") },
      { find: /^@workspace\.sh\/table-app\/node$/, replacement: here("../../packages/app/src/node.ts") },
      { find: /^@workspace\.sh\/table-fixtures$/, replacement: here("../../packages/table-fixtures/src/index.ts") },
    ],
    dedupe: ["react", "@gtkx/react", "@gtkx/css", "@gtkx/runtime", "fflate", "nanoid"],
    conditions: ["source", ...defaultServerConditions],
    preserveSymlinks: true,
  },
});
