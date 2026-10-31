// Expo config plugin: an app declares the `.table` types (src/tableTypes.ts)
// in its Info.plist. One app exports them, as their owner (Workspace); any
// other imports them (the .table demo), so the system knows them even where
// Workspace isn't installed.
//
//   plugins: [["<path to>/packages/core/app.plugin.cjs", { "declare": "exported" }]]
//
// Plain data on the config (ios.infoPlist), no mods: it needs no copy of
// Expo's config-plugins of its own. Kept the same as TABLE_TYPE_DECLARATIONS
// by src/tableTypes.test.ts.

const TABLE_TYPE_DECLARATIONS = [
  {
    UTTypeIdentifier: "sh.workspace.table",
    UTTypeDescription: "Table",
    UTTypeConformsTo: ["com.apple.package", "public.composite-content"],
    UTTypeTagSpecification: { "public.filename-extension": ["table"] },
  },
  {
    UTTypeIdentifier: "sh.workspace.table.file",
    UTTypeDescription: "Table",
    UTTypeConformsTo: ["public.data", "public.composite-content"],
    UTTypeTagSpecification: { "public.filename-extension": ["table"] },
  },
];

function withTableTypes(config, { declare = "imported" } = {}) {
  const key = declare === "exported" ? "UTExportedTypeDeclarations" : "UTImportedTypeDeclarations";
  const ios = config.ios ?? {};
  const infoPlist = ios.infoPlist ?? {};
  const existing = (infoPlist[key] ?? []).filter((d) => !TABLE_TYPE_DECLARATIONS.some((t) => t.UTTypeIdentifier === d.UTTypeIdentifier));
  return { ...config, ios: { ...ios, infoPlist: { ...infoPlist, [key]: [...existing, ...TABLE_TYPE_DECLARATIONS] } } };
}

module.exports = withTableTypes;
module.exports.TABLE_TYPE_DECLARATIONS = TABLE_TYPE_DECLARATIONS;
