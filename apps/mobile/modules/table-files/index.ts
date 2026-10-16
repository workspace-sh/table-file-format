// The phone's own bits (ios/TableFilesModule.swift): rename(2), a file moved
// over another in one step, which core's writer needs of a TableFs; the
// shake that asks to undo; and documents opened where they are.
import { requireNativeModule } from "expo-modules-core";

/** A document held open where it is (by its security scope), and kept for next time as `bookmark`. */
export interface HeldDocument {
  /** Its `file://` URL, as expo-file-system speaks. */
  uri: string;
  path: string;
  name: string;
  /** A folder (a .table's folder form), or a file. */
  directory: boolean;
  bookmark: string;
}

const TableFiles = requireNativeModule<{
  rename(from: string, to: string): void;
  shakeToUndoEnabled(): boolean;
  requestOrientation(to: string): void;
  pickDocument(types: string[]): Promise<HeldDocument | null>;
  resolveBookmark(bookmark: string): HeldDocument | null;
  holdDocument(path: string): HeldDocument;
  writeCoordinated(path: string, bytes: Uint8Array): Promise<void>;
  release(path: string): void;
  addListener(event: "onShake", listener: () => void): { remove(): void };
}>("TableFiles");

/** Ask for a document where it is, not a copy, of one of `types` (type identifiers or extensions); null when none was chosen. */
export function pickDocument(types: string[]): Promise<HeldDocument | null> {
  return TableFiles.pickDocument(types);
}

/** A document the app was given some other way (the system opening it in the app), held open as a picked one is. */
export function holdDocument(path: string): HeldDocument {
  return TableFiles.holdDocument(path);
}

/** A document kept from before, held open again; null when it's no longer there. */
export function resolveBookmark(bookmark: string): HeldDocument | null {
  return TableFiles.resolveBookmark(bookmark);
}

/** Replace the file at `path` (a path, not a URL) with `bytes`, as one coordinated write. */
export function writeCoordinated(path: string, bytes: Uint8Array): Promise<void> {
  return TableFiles.writeCoordinated(path, bytes);
}

/** Stop holding the document at `path` open. */
export function releaseDocument(path: string): void {
  TableFiles.release(path);
}

/** Move the file at `from` over `to` (paths, not URLs), replacing it atomically. */
export function renameOver(from: string, to: string): void {
  TableFiles.rename(from, to);
}

/**
 * Hear the phone being shaken, when the person has Shake to Undo on (and no
 * text field took the shake for its own undo). Returns the way to stop.
 */
export function onShakeToUndo(listener: () => void): () => void {
  const sub = TableFiles.addListener("onShake", () => {
    if (TableFiles.shakeToUndoEnabled()) listener();
  });
  return () => sub.remove();
}

/** Development: turn the screen to "landscape" or "portrait", as turning the phone does (the Simulator can't be turned from a script). */
export function requestOrientation(to: "landscape" | "portrait"): void {
  TableFiles.requestOrientation(to);
}
