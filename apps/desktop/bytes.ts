// A file's bytes, read and written through react-native-file-access, which
// carries binary as base64. For .table.zip files in and out.

import { FileSystem } from "react-native-file-access";

// String.fromCharCode takes its arguments on the stack: convert in chunks.
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return fromBase64(await FileSystem.readFile(path, "base64"));
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await FileSystem.writeFile(path, toBase64(bytes), "base64");
}
