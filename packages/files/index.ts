// Files on iOS, for the .table apps and Workspace (ios/TableFilesModule.swift):
// rename(2), a file moved over another in one step, which core's writer
// needs of a TableFs; documents opened where they are, and a coordinated
// write for a file the app was only given; and the shake that asks to undo.
import { requireOptionalNativeModule } from "expo-modules-core";

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

type TableFilesModule = {
  rename(from: string, to: string): void;
  shakeToUndoEnabled(): boolean;
  requestOrientation(to: string): void;
  pickDocument(types: string[]): Promise<HeldDocument | null>;
  resolveBookmark(bookmark: string): HeldDocument | null;
  holdDocument(path: string): HeldDocument;
  writeCoordinated(path: string, bytes: Uint8Array): Promise<void>;
  release(path: string): void;
  addListener(event: "onShake", listener: () => void): { remove(): void };
};

// Apple's module (ios/TableFilesModule.swift). Android has none yet, so it's
// loaded optionally: the app starts, and what needs it says so when used.
const Native = requireOptionalNativeModule<TableFilesModule>("TableFiles");

/** Whether this build has the native module (Apple's; not Android's yet). */
export const hasTableFiles = Native !== null;

function native(): TableFilesModule {
  if (Native === null) throw new Error("This needs Files support that isn’t on Android yet.");
  return Native;
}

/** Ask for a document where it is, not a copy, of one of `types` (type identifiers or extensions); null when none was chosen. */
export function pickDocument(types: string[]): Promise<HeldDocument | null> {
  return native().pickDocument(types);
}

/** A document the app was given some other way (the system opening it in the app), held open as a picked one is. */
export function holdDocument(path: string): HeldDocument {
  return native().holdDocument(path);
}

/** A document kept from before, held open again; null when it's no longer there. */
export function resolveBookmark(bookmark: string): HeldDocument | null {
  return native().resolveBookmark(bookmark);
}

/** Replace the file at `path` (a path, not a URL) with `bytes`, as one coordinated write. */
export function writeCoordinated(path: string, bytes: Uint8Array): Promise<void> {
  return native().writeCoordinated(path, bytes);
}

/** Stop holding the document at `path` open. */
export function releaseDocument(path: string): void {
  native().release(path);
}

/** Move the file at `from` over `to` (paths, not URLs), replacing it atomically. */
export function renameOver(from: string, to: string): void {
  native().rename(from, to);
}

/**
 * Hear the phone being shaken, when the person has Shake to Undo on (and no
 * text field took the shake for its own undo). Returns the way to stop.
 */
export function onShakeToUndo(listener: () => void): () => void {
  if (Native === null) return () => {};
  const module = Native;
  const sub = module.addListener("onShake", () => {
    if (module.shakeToUndoEnabled()) listener();
  });
  return () => sub.remove();
}

/** Development: turn the screen to "landscape" or "portrait", as turning the phone does (the Simulator can't be turned from a script). */
export function requestOrientation(to: "landscape" | "portrait"): void {
  Native?.requestOrientation(to);
}
export { expoFs, expoIndexHost, pathOfUri, type ExpoIndexHostOptions } from "./expo";
