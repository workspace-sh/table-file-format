// The phone's own bits (ios/TableFilesModule.swift): rename(2), a file moved
// over another in one step, which core's writer needs of a TableFs; and the
// shake that asks to undo.
import { requireNativeModule } from "expo-modules-core";

const TableFiles = requireNativeModule<{
  rename(from: string, to: string): void;
  shakeToUndoEnabled(): boolean;
  addListener(event: "onShake", listener: () => void): { remove(): void };
}>("TableFiles");

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
