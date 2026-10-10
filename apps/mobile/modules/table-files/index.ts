// rename(2) on the phone (ios/TableFilesModule.swift): a file moved over
// another in one step, which core's writer needs of a TableFs.
import { requireNativeModule } from "expo-modules-core";

const TableFiles = requireNativeModule<{ rename(from: string, to: string): void }>("TableFiles");

/** Move the file at `from` over `to` (paths, not URLs), replacing it atomically. */
export function renameOver(from: string, to: string): void {
  TableFiles.rename(from, to);
}
