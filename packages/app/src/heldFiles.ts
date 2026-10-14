// The same .table held by more than one view at once: two embeds of a file in
// one document, or an embed and the file opened beside it. Each holds its own
// state (where it is, what it shows); what they hold of the file is kept in
// step. An edit made in one is told to the others, which take the table as it
// now is (`reloaded`, so it isn't theirs to write); and a file being written
// is waited for before it is read again, so a view opened just after an edit
// reads the edit.

import type { ParsedTable } from "@workspace.sh/table-core";

/** Told that a table of a file changed: its name in the file, the table as it is, and which view changed it. */
export type HeldFileListener = (name: string, table: ParsedTable, from: object) => void;

const listeners = new Map<string, Set<HeldFileListener>>();
const writing = new Map<string, Promise<void>>();

/** Hear of changes to the file at `path` made by other views. Returns the way to stop. */
export function heldFile(path: string, listener: HeldFileListener): () => void {
  let held = listeners.get(path);
  if (!held) listeners.set(path, (held = new Set()));
  held.add(listener);
  return () => {
    held!.delete(listener);
    if (held!.size === 0) listeners.delete(path);
  };
}

/** Tell the other views holding the file at `path` that one of its tables changed. */
export function tellHeld(path: string, name: string, table: ParsedTable, from: object): void {
  for (const listener of listeners.get(path) ?? []) listener(name, table, from);
}

/** A write of the file at `path` under way: a read of it waits for this. */
export function noteWriting(path: string, write: Promise<unknown>): void {
  const after = (writing.get(path) ?? Promise.resolve()).then(
    () => write.then(() => undefined, () => undefined),
    () => undefined,
  );
  writing.set(path, after);
  void after.then(() => {
    if (writing.get(path) === after) writing.delete(path);
  });
}

/** When every write of the file at `path` that was under way has ended. */
export function settled(path: string): Promise<void> {
  return writing.get(path) ?? Promise.resolve();
}
