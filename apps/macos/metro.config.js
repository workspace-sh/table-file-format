const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

/**
 * Metro config for the bare RN macOS app inside an npm-workspaces monorepo.
 * Same shape as apps/mobile/metro.config.js — see there for the rationale on:
 *   - watchFolders (monorepo root)
 *   - resolveRequest .js → .ts shim for workspace package consumption
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const defaultConfig = getDefaultConfig(projectRoot);
const defaultResolveRequest = defaultConfig.resolver.resolveRequest;

const config = {
  projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
    disableHierarchicalLookup: true,
    resolveRequest: (context, moduleName, platform) => {
      if (
        (moduleName.startsWith("./") || moduleName.startsWith("../")) &&
        moduleName.endsWith(".js")
      ) {
        const base = moduleName.slice(0, -".js".length);
        for (const ext of [".ts", ".tsx"]) {
          try {
            return context.resolveRequest(context, base + ext, platform);
          } catch {
            // fall through
          }
        }
      }
      return defaultResolveRequest
        ? defaultResolveRequest(context, moduleName, platform)
        : context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
