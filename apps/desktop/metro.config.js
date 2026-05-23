const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

/**
 * Metro config for the bare RN macOS app inside an npm-workspaces monorepo.
 * Mirrors `react-native-source-editor`'s example/macos-app pattern.
 *
 * Key bits:
 *   - watchFolders includes the monorepo root so workspace packages
 *     live-reload.
 *   - blockList prevents Metro picking up duplicate react/react-native
 *     in the hoisted root node_modules (would cause dual-React-instance
 *     hook errors).
 *   - unstable_enablePackageExports + unstable_conditionNames: ['source',
 *     ...] tells Metro to read `src/index.ts` directly via the `source`
 *     exports condition. Without this, @react-native/metro-config
 *     resolves to `dist/index.js` (which doesn't exist until
 *     `npm run build:core`).
 *   - platforms includes 'macos' for react-native-macos resolution.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const baseConfig = getDefaultConfig(projectRoot);

// Block any node_modules/react copy outside this app's own node_modules.
// Workspace packages (packages/ui, packages/core) may install their own
// react via devDeps; if Metro resolves to those copies, we end up with
// dual React instances and "Cannot read property 'useState' of null".
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockExact = (p) => new RegExp(`^${escapeRe(p)}(\\/|$)`);

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    blockList: [
      ...Array.from(baseConfig.resolver.blockList ?? []),
      // Root hoisted copies — bare `node_modules/react` prefix would
      // otherwise match `react-strict-dom`, `react-native-safe-area-context`, etc.
      blockExact(path.resolve(workspaceRoot, "node_modules", "react")),
      blockExact(path.resolve(workspaceRoot, "node_modules", "react-native")),
      // RNGH registers native view components at module-load time; a
      // second copy of the JS module re-registers the same names and
      // throws "Tried to register two views with the same name
      // RNGestureHandlerButton". Force Metro to THIS app's copy.
      blockExact(
        path.resolve(workspaceRoot, "node_modules", "react-native-gesture-handler"),
      ),
      // Per-package node_modules — workspace packages install react as a
      // devDep for typecheck. Block them so Metro walks past and lands on
      // THIS app's copy.
      blockExact(path.resolve(workspaceRoot, "packages/ui/node_modules", "react")),
      blockExact(path.resolve(workspaceRoot, "packages/core/node_modules", "react")),
      blockExact(
        path.resolve(
          workspaceRoot,
          "packages/ui/node_modules",
          "react-native-gesture-handler",
        ),
      ),
    ],
    platforms: ["macos", "ios", "native"],
    unstable_enablePackageExports: true,
    unstable_conditionNames: [
      "source",
      "react-native",
      "require",
      "default",
    ],
  },
};

module.exports = mergeConfig(baseConfig, config);
