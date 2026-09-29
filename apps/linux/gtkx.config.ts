import { defineConfig } from "@gtkx/config";

export default defineConfig({
  // The demo's own id. When Workspace's Linux client renders tables it uses
  // table-gtk under its own id; this one never ships beside it.
  applicationId: "sh.workspace.TableDemo",
  // Every GTKX 2.0 behaviour now, so there is nothing to migrate later.
  future: {
    v2ByteArrays: true,
    v2ValueReturns: true,
    v2FinishResults: true,
    v2InoutReturns: true,
    v2ResourceImports: true,
    v2DefaultLibraries: true,
    v2TreeShaking: true,
  },
});
