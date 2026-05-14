const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");

/**
 * Metro config for the bare RN-macOS app. Watches the monorepo root so
 * the @workspace/table-core source picks up changes during development.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = {
  projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    disableHierarchicalLookup: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
