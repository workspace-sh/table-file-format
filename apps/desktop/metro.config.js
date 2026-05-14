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

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    blockList: [
      ...Array.from(baseConfig.resolver.blockList ?? []),
      // Anchored regexes — bare `node_modules/react` prefix would otherwise
      // match `react-strict-dom`, `react-native-safe-area-context`, etc.
      new RegExp(
        `^${path
          .resolve(workspaceRoot, "node_modules", "react")
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/|$)`,
      ),
      new RegExp(
        `^${path
          .resolve(workspaceRoot, "node_modules", "react-native")
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/|$)`,
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
