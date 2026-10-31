// A `.table` is one document in either of two forms (SPEC section 13, D49):
// a folder of plain files, declared as a package so Files and the document
// picker show it as a single item, not a folder to browse into; or a single
// file holding that folder as a zip, declared as data so it's never offered
// for unzipping. One extension, one name, so both show as "Table"; the
// system types a `.table` by whether it is a folder.
//
// The apps declare them through app.plugin.cjs (beside this package), which
// holds the same declarations for Expo's config, outside TypeScript; a test
// keeps the two the same.

/** The system's type identifiers for a `.table`, by its form. */
export const TABLE_TYPES = {
  folder: "sh.workspace.table",
  file: "sh.workspace.table.file",
} as const;

/** How Apple's platforms declare the two (Info.plist's UTExportedTypeDeclarations or UTImportedTypeDeclarations). */
export const TABLE_TYPE_DECLARATIONS = [
  {
    UTTypeIdentifier: TABLE_TYPES.folder,
    UTTypeDescription: "Table",
    UTTypeConformsTo: ["com.apple.package", "public.composite-content"],
    UTTypeTagSpecification: { "public.filename-extension": ["table"] },
  },
  {
    UTTypeIdentifier: TABLE_TYPES.file,
    UTTypeDescription: "Table",
    UTTypeConformsTo: ["public.data", "public.composite-content"],
    UTTypeTagSpecification: { "public.filename-extension": ["table"] },
  },
];
