// One index per .table folder, however many views read it: an embed of a
// large table and the same file opened as a document ask one host (one
// SQLite connection, one worker), not one each. A host is opened by the first
// view that asks and closed when the last lets go.

import type { IndexHost } from "@workspace.sh/table-app/node";

const held = new Map<string, { host: IndexHost; users: number }>();

/**
 * `open`, shared: each call for a folder already held gives the same host, and
 * its `close` lets go of it, closing it only when nothing else holds it.
 */
export function sharedIndexHosts(open: (bundleDir: string) => IndexHost): (bundleDir: string) => IndexHost {
  return (bundleDir) => {
    let entry = held.get(bundleDir);
    if (!entry) held.set(bundleDir, (entry = { host: open(bundleDir), users: 0 }));
    entry.users++;
    const shared = entry;
    let released = false;
    return {
      ...shared.host,
      close: async () => {
        if (released) return;
        released = true;
        shared.users--;
        if (shared.users > 0) return;
        if (held.get(bundleDir) === shared) held.delete(bundleDir);
        await shared.host.close();
      },
    };
  };
}

/** How many views hold the index of the folder at `bundleDir`: for tests. */
export function indexHostUsers(bundleDir: string): number {
  return held.get(bundleDir)?.users ?? 0;
}
