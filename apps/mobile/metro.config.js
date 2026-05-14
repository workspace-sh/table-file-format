const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro config for the Expo mobile app inside an npm-workspaces monorepo.
 *
 * Two notable things:
 *
 * 1. `watchFolders` includes the monorepo root so changes to workspace
 *    packages (@workspace/table-core, @workspace/table-ui) live-reload.
 * 2. The custom `resolveRequest` maps `.js` extensions in relative
 *    imports to `.ts` source. `packages/core` is TypeScript source using
 *    `.js` extensions (NodeNext convention required for tsc + Node ESM),
 *    but Metro doesn't try `.ts` when it sees an explicit `.js` request.
 *    Without this shim, every `import "./types.js"` inside the core
 *    package fails to resolve at bundle time.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // For relative imports ending in .js, try the .ts/.tsx source first
  // when the request originates inside a workspace package. This unblocks
  // workspace-as-source consumption without forcing every package to
  // pre-build to dist/.
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
};

module.exports = config;
