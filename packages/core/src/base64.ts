// Bytes as base64 and back, for platforms that carry binary as text
// (react-native-file-access, a single-file .table handed over as base64).

// String.fromCharCode takes its arguments on the stack: convert in chunks.
const CHUNK = 0x8000;
// Hermes and Node have them; React Native's types don't say so.
const { atob, btoa } = globalThis as unknown as { atob: (data: string) => string; btoa: (data: string) => string };

/** Bytes as base64. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Base64 back to bytes. */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
