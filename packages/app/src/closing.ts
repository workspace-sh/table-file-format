// Closing a file: it leaves the sidebar, and what the app kept of it goes
// (#501). A folder read from disk stays where it is; a file the app keeps
// itself (opened from a single-file .table, made here, an example) is removed from
// the app's own space. The reducer takes it out of what's held and marks
// the bundle to write; an app's write, given a bundle it no longer holds,
// removes what it kept of it (its store's copy, a large table's folder).

import type { BundleMeta } from "@workspace.sh/table-core";

import { CANCEL, type Confirm } from "./confirm.ts";

/** The question before closing `title`: `fromFolder` when it was read from a folder on disk. */
export function closePrompt(title: string, fromFolder: boolean): Confirm {
  return {
    heading: `Close “${title}”?`,
    body: fromFolder
      ? "The folder stays where it is, and can be opened again."
      : "This app's copy is removed. A file you opened it from isn't touched.",
    responses: [CANCEL, { id: "close", label: "Close", destructive: true }],
  };
}

/** Whether `bundle` can be closed: it's held, and another file stays open (an app always has a table on screen). */
export function canClose(bundles: Record<string, BundleMeta>, bundle: string): boolean {
  return bundle in bundles && Object.keys(bundles).length > 1;
}

/** Of the bundles a write was given, those closed: no longer held, so what the app kept of them goes. */
export function closedIn(written: readonly string[], metas: Record<string, BundleMeta>): string[] {
  return written.filter((b) => !(b in metas));
}

/** The bundles closed here, as an app keeps them: an example closed stays out of the next launch's (withNewFixtures). */
export function withClosed(closed: readonly string[], bundle: string): string[] {
  return closed.includes(bundle) ? [...closed] : [...closed, bundle];
}
