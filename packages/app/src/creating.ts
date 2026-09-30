// Making things: a new view, a new table in a bundle (as a new sheet goes
// into a workbook, D37), a new `.table` file. What each app does after the
// name is asked for; how it asks is the app's own.

import { newBundle, newId, newTable } from "@workspace.sh/table-core";
import type { BundleMeta, ParsedTable, View } from "@workspace.sh/table-core";

import { bundleTables, fromBundle } from "./bundles.ts";
import { tableKeyFor } from "./tableKey.ts";

/** The app's tables and manifests with something made, and where to show it. */
export interface Made {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  /** The new table's `bundle/table` key. */
  key: string;
  /** Its first view. */
  viewId: string;
}

/** A new view: a plain table of everything, for its settings to make into what's wanted. */
export function newView(): View {
  return { id: newId(), name: "New view", layout: "table" };
}

/** A new table titled `title` in `bundle`, named from the title, last in the bundle's order. */
export function withNewTable(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  bundle: string,
  title: string,
  now?: Date,
): Made {
  const name = tableKeyFor(title, Object.keys(bundleTables(tables, bundle)));
  const made = newTable(title, `${bundle}.table/tables/${name}`, now);
  const meta = bundles[bundle] ?? {};
  const order = meta.tables ?? Object.keys(bundleTables(tables, bundle));
  return {
    tables: { ...tables, [`${bundle}/${name}`]: made },
    bundles: { ...bundles, [bundle]: { ...meta, tables: [...order, name] } },
    key: `${bundle}/${name}`,
    viewId: made.views[0]!.id,
  };
}

/** A new `.table` file titled `title`: a bundle holding one new table of the same name. */
export function withNewFile(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  title: string,
  now?: Date,
): Made {
  const key = tableKeyFor(title, Object.keys(bundles));
  const name = tableKeyFor(title, []);
  const made = newBundle(title, `${key}.table`, name, now);
  return {
    tables: { ...tables, ...fromBundle(key, made) },
    bundles: { ...bundles, [key]: made.meta },
    key: `${key}/${name}`,
    viewId: made.tables[name]!.views[0]!.id,
  };
}

/** What's being made: a table in a bundle, or a `.table` file. */
export type Making = { kind: "table"; bundle: string } | { kind: "file" };

/** Asking for the new thing's name: each app shows it its own way. */
export interface NamePrompt {
  heading: string;
  /** The button that makes it. */
  action: string;
  /** The name field's placeholder. */
  placeholder: string;
}

export function namePrompt(making: Making, bundles: Record<string, BundleMeta>): NamePrompt {
  return {
    heading:
      making.kind === "table" ? `New table in ${bundles[making.bundle]?.title ?? making.bundle}` : "New .table file",
    action: "Create",
    placeholder: "Name",
  };
}

/**
 * Making it with the name given: trimmed, and nothing made when it's empty
 * or the prompt was cancelled (null). What's made shows at once, its first
 * view, with the search cleared and no document open.
 */
export function creating(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  making: Making,
  name: string | null | undefined,
  now?: Date,
): (Made & { search: ""; openBody: null }) | null {
  const title = name?.trim();
  if (!title) return null;
  const made =
    making.kind === "table" ? withNewTable(tables, bundles, making.bundle, title, now) : withNewFile(tables, bundles, title, now);
  return { ...made, search: "", openBody: null };
}
