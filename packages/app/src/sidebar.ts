// The sidebar's tree, as plain data: each .table file (a bundle), its
// tables in the manifest's order, and under an expanded table its views
// (D37: a view is seen as part of its table, a table as part of its file).
// The web, macOS and Linux each draw it; what's folded, expanded and shown
// is theirs to say, so it comes in as input.

import type { BundleMeta, ParsedTable, View, ViewLayout } from "@workspace.sh/table-core";
import { LAYOUT_LABELS } from "@workspace.sh/table-ui/shared";

import { bundleOf, tableKeysIn, tableNameOf } from "./bundles.ts";

export interface SidebarView {
  view: View;
  id: string;
  name: string;
  layout: ViewLayout;
  /** "Table", "Board"…: for a UI that names the layout rather than showing its key. */
  layoutLabel: string;
  /** The view on screen. */
  active: boolean;
}

export interface SidebarTable {
  /** The table's `bundle/table` key. */
  key: string;
  title: string;
  /** Its folder under tables/, as the address names it: `deals/`. */
  folder: string;
  rowCount: number;
  expanded: boolean;
  /** Its views, when expanded; empty when not. */
  views: SidebarView[];
}

export interface SidebarBundle {
  bundle: string;
  title: string;
  /** The file's name: `crm.table`. */
  file: string;
  folded: boolean;
  /** Its tables, unless folded. */
  tables: SidebarTable[];
  /** Whether to offer "+ New table" in this bundle, as `newTableIn` says. */
  offersNewTable: boolean;
}

export interface SidebarOptions {
  /** Bundles folded away. */
  folded?: Iterable<string>;
  /** Tables whose views are listed. The web and Linux expand the open one. */
  expanded?: Iterable<string>;
  /** The view on screen. */
  active?: { key: string; viewId: string };
  /**
   * Where "+ New table" is offered: in the bundle of the table on screen
   * (`"active"`, the web), in every bundle (`"every"`), or nowhere (`"none"`,
   * for a UI that puts it on the bundle's heading).
   */
  newTableIn?: "active" | "every" | "none";
}

export function sidebarTree(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  options: SidebarOptions = {},
): SidebarBundle[] {
  const folded = new Set(options.folded ?? []);
  const expanded = new Set(options.expanded ?? []);
  const active = options.active;
  const newTableIn = options.newTableIn ?? "active";
  return Object.keys(bundles).map((bundle) => {
    const isFolded = folded.has(bundle);
    return {
      bundle,
      title: bundles[bundle]?.title ?? bundle,
      file: `${bundle}.table`,
      folded: isFolded,
      offersNewTable:
        !isFolded && (newTableIn === "every" || (newTableIn === "active" && active !== undefined && bundleOf(active.key) === bundle)),
      tables: isFolded
        ? []
        : tableKeysIn(tables, bundles, bundle).map((key) => {
            const table = tables[key]!;
            const isExpanded = expanded.has(key);
            return {
              key,
              title: table.meta.title ?? key,
              folder: `${tableNameOf(key)}/`,
              rowCount: table.rows.length,
              expanded: isExpanded,
              views: isExpanded
                ? table.views.map((view) => ({
                    view,
                    id: view.id,
                    name: view.name,
                    layout: view.layout,
                    layoutLabel: LAYOUT_LABELS[view.layout],
                    active: active?.key === key && active.viewId === view.id,
                  }))
                : [],
            };
          }),
    };
  });
}

/** One line of the tree, for a UI that draws it as a flat list (GTK's ListBox). */
export type SidebarEntry =
  | { kind: "bundle"; bundle: SidebarBundle }
  | { kind: "table"; table: SidebarTable }
  | { kind: "view"; key: string; view: SidebarView };

export function flattenSidebar(tree: SidebarBundle[]): SidebarEntry[] {
  return tree.flatMap((bundle): SidebarEntry[] => [
    { kind: "bundle", bundle },
    ...bundle.tables.flatMap((table): SidebarEntry[] => [
      { kind: "table", table },
      ...table.views.map((view): SidebarEntry => ({ kind: "view", key: table.key, view })),
    ]),
  ]);
}
