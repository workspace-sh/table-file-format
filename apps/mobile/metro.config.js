const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro config for the Expo mobile app inside an npm-workspaces monorepo.
 *
 * Pattern copied from `react-native-source-editor`'s example/expo-app +
 * example/macos-app: the library/workspace package is consumed as TS
 * source via the `source` exports condition. `expo/metro-config` already
 * enables package exports; we also set the resolution conditions
 * explicitly so the order is documented (source → react-native → ...).
 *
 * `blockList` prevents Metro from finding duplicate copies of `react` /
 * `react-native` in the monorepo root's node_modules (which it would
 * pick up because npm hoists), which would otherwise cause "Invalid
 * hook call" runtime errors from dual React instances.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Anchor the regex with a trailing path-separator-or-end so we don't
// accidentally block `react-strict-dom`, `react-native-safe-area-context`,
// etc. The bare `node_modules/react` prefix would otherwise match them all.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockExact = (p) => new RegExp(`^${escapeRe(p)}(\\/|$)`);

config.resolver.blockList = [
  ...Array.from(config.resolver.blockList ?? []),
  // Root hoisted copies.
  blockExact(path.resolve(workspaceRoot, "node_modules", "react")),
  blockExact(path.resolve(workspaceRoot, "node_modules", "react-native")),
  // Per-package node_modules — workspace packages install react as a
  // devDep for typecheck. Block them so Metro walks past and lands on
  // THIS app's copy (otherwise dual-React instance → useState is null).
  blockExact(path.resolve(workspaceRoot, "packages/ui/node_modules", "react")),
  blockExact(path.resolve(workspaceRoot, "packages/core/node_modules", "react")),
];

// Honour the `source` exports condition in workspace packages so Metro
// reads `src/index.ts` directly without requiring a build step. Order
// matters: most-specific → least.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  "source",
  "react-native",
  "require",
  "default",
];

module.exports = config;
