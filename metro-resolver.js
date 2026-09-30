// Shared by the React Native apps' Metro configs (apps/desktop, apps/mobile).
//
// Workspace packages are TypeScript written for Node's ESM rules, so they
// import siblings as "./expr.js" while the file is expr.ts (core since #54).
// Metro doesn't map one to the other, and a package that can't be resolved
// fails the whole bundle. resolveTsForJs tries the .ts, then .tsx, file for
// a relative ".js" import, and otherwise resolves as usual.

const fs = require("fs");
const path = require("path");

/**
 * A Metro resolveRequest step. `resolve` is what to hand the (possibly
 * mapped) name to: another resolver in the chain, or Metro's own
 * (`context.resolveRequest`) by default.
 */
function resolveTsForJs(context, moduleName, platform, resolve = context.resolveRequest) {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    for (const ext of [".ts", ".tsx"]) {
      if (fs.existsSync(base + ext)) return resolve(context, moduleName.slice(0, -3) + ext, platform);
    }
  }
  return resolve(context, moduleName, platform);
}

module.exports = { resolveTsForJs };
