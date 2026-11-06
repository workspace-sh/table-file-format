// Files on iOS and Android, for the .table apps and Workspace
// (ios/TableFilesModule.swift, android/…/TableFilesModule.kt): rename(2), a
// file moved over another in one step, which core's writer needs of a
// TableFs; documents opened where they are, and a coordinated write for a
// file the app was only given; and, on iOS, the shake that asks to undo.
// Android holds a picked document as a copy in the app's files, written
// through to the document on each write.
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
  /** Sync on Apple's, async on Android's (which copies the document); an error where it's there but can't be held. */
  resolveBookmark(bookmark: string): HeldDocument | Unheld | null | Promise<HeldDocument | Unheld | null>;
  /** Android's: the document's own size and time, for a copy held for one. */
  documentStamp?(path: string): Promise<string | null>;
  holdDocument(path: string): HeldDocument;
  writeCoordinated(path: string, bytes: Uint8Array): Promise<void>;
  release(path: string): void;
  addListener(event: "onShake", listener: () => void): { remove(): void };
};

// The platform's module. Loaded optionally: an app built without it (the
// web, or a build that leaves it out) starts, and what needs it says so when used.
const Native = requireOptionalNativeModule<TableFilesModule>("TableFiles");

/** Whether this build has the native module. */
export const hasTableFiles = Native !== null;

function native(): TableFilesModule {
  if (Native === null) throw new Error("This needs Files support that this build doesn’t have.");
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

/** A document kept from before that's there but can't be held again: why (its grant taken away, say). */
export interface Unheld {
  error: string;
  bookmark: string;
}

/** A document kept from before, held open again; null when it's no longer there, `Unheld` when it can't be held. */
export async function resolveBookmark(bookmark: string): Promise<HeldDocument | Unheld | null> {
  return native().resolveBookmark(bookmark);
}

/**
 * The document itself as it is now (its size and time), where a held file
 * is a copy of it (Android): what says whether it changed elsewhere. Null
 * where the held file is the document (Apple's), whose own stamp is that.
 */
export async function documentStamp(path: string): Promise<string | null> {
  return Native?.documentStamp ? Native.documentStamp(path) : null;
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
