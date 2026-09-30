// How this viewer left the sidebar: open or collapsed, and which groups
// they folded. Personal, kept in this browser, never in a table. Reset
// demo data leaves it alone, as it does the display settings.

import type { KeyValueStore } from "./savedTables.ts";

export const SIDEBAR_KEY = "table-demo:sidebar";

export interface SidebarPrefs {
  /** Collapsed out of the way (⌘B / Ctrl+B), or showing. Absent: showing. */
  collapsed?: boolean;
  /** `.table` files whose tables are folded away, by name. */
  foldedFiles?: string[];
  /** The Display settings group, folded away. */
  foldedDisplay?: boolean;
  /** Showing the files on disk rather than the tables and views. Absent: tables. */
  files?: boolean;
}

export function loadSidebarPrefs(store: KeyValueStore | null): SidebarPrefs {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(SIDEBAR_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const { collapsed, foldedFiles, foldedDisplay, files } = parsed as Record<string, unknown>;
    return {
      ...(collapsed === true ? { collapsed } : {}),
      ...(Array.isArray(foldedFiles) && foldedFiles.every((f) => typeof f === "string") && foldedFiles.length > 0
        ? { foldedFiles: foldedFiles as string[] }
        : {}),
      ...(typeof foldedDisplay === "boolean" ? { foldedDisplay } : {}),
      ...(files === true ? { files } : {}),
    };
  } catch {
    return {};
  }
}

export function saveSidebarPrefs(store: KeyValueStore | null, prefs: SidebarPrefs): void {
  try {
    store?.setItem(SIDEBAR_KEY, JSON.stringify(prefs));
  } catch {
    // Not kept past a reload; still applied now.
  }
}

/**
 * The prefs with `bundle`'s file unfolded, so the table on screen is never
 * hidden in a folded file; the same prefs when it isn't folded. Folding it
 * again afterwards is still the viewer's to do.
 */
export function withFileUnfolded(prefs: SidebarPrefs, bundle: string): SidebarPrefs {
  const folded = prefs.foldedFiles ?? [];
  return folded.includes(bundle) ? { ...prefs, foldedFiles: folded.filter((b) => b !== bundle) } : prefs;
}

/** The prefs with `bundle`'s file folded if it was open, or opened if it was folded. */
export function withFileToggled(prefs: SidebarPrefs, bundle: string): SidebarPrefs {
  const folded = prefs.foldedFiles ?? [];
  return { ...prefs, foldedFiles: folded.includes(bundle) ? folded.filter((b) => b !== bundle) : [...folded, bundle] };
}
