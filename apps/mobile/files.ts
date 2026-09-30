// .table.zip in and out on a phone: chosen with the system's document
// picker, and handed to the share sheet (Save to Files, AirDrop, Mail…).
// Reading and writing the archive is table-app's (openArchive,
// bundleToArchive), as on the web, macOS and Linux; so is the wording of
// what went wrong. All three Expo modules work in Expo Go.

import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { archiveFileName, bundleToArchive, fromBundle, openArchive, toBundle, type Library } from "@workspace.sh/table-app";

/** What opening an archive gave: a library to take in, what was skipped, and the file's name. */
export interface OpenedZip {
  library: Library;
  skipped: string[];
  name: string;
}

/** A .table.zip that couldn't be read: its name, and why. */
export class ZipError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: unknown,
  ) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

/** Ask for a .table.zip and read it, named apart from `held`. Null when nothing was chosen. */
export async function chooseZip(held: Iterable<string>): Promise<OpenedZip | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["application/zip", "application/x-zip-compressed", "public.zip-archive"],
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  let opened;
  try {
    opened = await openArchive(await new File(asset.uri).bytes(), held);
  } catch (error) {
    throw new ZipError(asset.name, error);
  }
  return {
    library: {
      tables: fromBundle(opened.key, opened.bundle),
      bundles: { [opened.key]: opened.bundle.meta },
      paths: {},
      problems: {},
    },
    skipped: opened.skipped,
    name: asset.name,
  };
}

/** A bundle as a .table.zip, offered to the share sheet. Resolves once the sheet is done. */
export async function shareZip(
  bundle: string,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
): Promise<void> {
  const file = new File(Paths.cache, archiveFileName(bundle));
  if (file.exists) file.delete();
  file.create();
  file.write(await bundleToArchive(bundle, toBundle(tables, bundles, bundle)));
  await Sharing.shareAsync(file.uri, { mimeType: "application/zip", UTI: "public.zip-archive", dialogTitle: archiveFileName(bundle) });
}
