// A file's bytes, read and written through react-native-file-access, which
// carries binary as base64. For .table.zip files in and out.

import { FileSystem } from "react-native-file-access";
import { fromBase64, toBase64 } from "@workspace.sh/table-app/mac-index-host";

export { fromBase64, toBase64 };

export async function readBytes(path: string): Promise<Uint8Array> {
  return fromBase64(await FileSystem.readFile(path, "base64"));
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await FileSystem.writeFile(path, toBase64(bytes), "base64");
}
