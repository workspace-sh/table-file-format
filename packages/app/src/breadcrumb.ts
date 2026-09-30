// Where a view is, above its name: "Shop (shop.table) › Orders", the file
// and the table (D37). A file whose one table shares its title names it
// once. Each app draws it; the words are here.

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";

import { bundleOf, tableNameOf } from "./bundles.ts";

export interface Breadcrumb {
  /** "Shop (shop.table)". */
  file: string;
  /** "Orders"; absent when the table shares the file's title. */
  table?: string;
  /** Both, as one line: "Shop (shop.table) › Orders". */
  text: string;
}

/** `fileName`: what the file is called where it is (an opened folder's own name); `bundle.table` otherwise. */
export function tableBreadcrumb(
  key: string,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  fileName?: string,
): Breadcrumb {
  const bundle = bundleOf(key);
  const fileTitle = bundles[bundle]?.title ?? bundle;
  const tableTitle = tables[key]?.meta.title ?? tableNameOf(key);
  const file = `${fileTitle} (${fileName ?? `${bundle}.table`})`;
  return tableTitle === fileTitle ? { file, text: file } : { file, table: tableTitle, text: `${file} › ${tableTitle}` };
}
