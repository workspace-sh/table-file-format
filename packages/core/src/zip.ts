import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

/**
 * Minimal zip read/write for the `.table.zip` transport convention
 * (SPEC section 13). Portable: runs on Node, browsers, and React
 * Native (Hermes) — no Node globals, no platform APIs. The container
 * logic (layout, security posture, determinism) is ours; only the
 * raw-deflate codec comes from `fflate` (pure JS, DECISIONS D28).
 *
 * Scope is the convention, not the whole zip universe: methods
 * stored (0) and deflate (8), UTF-8 names, no encryption, no
 * multi-volume, no zip64. Central directory is authoritative on
 * read; CRC-32 and sizes are verified per entry.
 *
 * Security posture (SPEC section 13):
 * - Entry names are validated on read — `..` segments, absolute
 *   paths, backslashes, and drive prefixes are rejected outright, so
 *   even extracting consumers that trust this listing cannot be
 *   zip-slipped by it.
 * - Total declared uncompressed size is capped (decompression-bomb
 *   bound); actual inflated size must match the declaration.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. "x.table/schema.json". */
  name: string;
  data: Uint8Array;
}

/** 1 GiB default cap on total declared uncompressed size. */
export const ZIP_MAX_TOTAL_BYTES = 1 << 30;

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

// Fixed DOS timestamp (1980-01-01 00:00) — archives are byte-
// deterministic for identical input (SPEC section 3, canonical write
// order), so timestamps cannot leak into the output.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Reject entry names that could escape an extraction root. */
function assertSafeEntryName(name: string): void {
  const bad =
    name.length === 0 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split("/").includes("..");
  if (bad) {
    throw new Error(`unsafe archive entry name: ${JSON.stringify(name)}`);
  }
}

export function readZip(
  source: Uint8Array,
  opts?: { maxTotalBytes?: number },
): ZipEntry[] {
  const buf = source;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const maxTotal = opts?.maxTotalBytes ?? ZIP_MAX_TOTAL_BYTES;

  // End-of-central-directory: scan backwards over the trailing
  // comment space (max 65535 + 22 bytes).
  let eocd = -1;
  const scanFrom = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (u32(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip archive (no end-of-central-directory)");

  const count = u16(eocd + 10);
  const cdOffset = u32(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("zip64 archives are not supported");
  }

  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  let declaredTotal = 0;

  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || u32(pos) !== CENTRAL_SIG) {
      throw new Error("corrupt zip: bad central directory entry");
    }
    const method = u16(pos + 10);
    const crc = u32(pos + 16);
    const compSize = u32(pos + 20);
    const uncompSize = u32(pos + 24);
    const nameLen = u16(pos + 28);
    const extraLen = u16(pos + 30);
    const commentLen = u16(pos + 32);
    const localOffset = u32(pos + 42);
    const name = strFromU8(buf.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw new Error("zip64 archives are not supported");
    }
    if (name.endsWith("/")) continue; // directory entry — implicit

    assertSafeEntryName(name);

    declaredTotal += uncompSize;
    if (declaredTotal > maxTotal) {
      throw new Error(
        `archive exceeds the ${maxTotal}-byte uncompressed cap (decompression-bomb guard)`,
      );
    }

    // Local header repeats name/extra with possibly different extra
    // length — read it to find where the data actually starts.
    if (localOffset + 30 > buf.length || u32(localOffset) !== LOCAL_SIG) {
      throw new Error(`corrupt zip: bad local header for ${name}`);
    }
    const localNameLen = u16(localOffset + 26);
    const localExtraLen = u16(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (raw.length !== compSize) throw new Error(`corrupt zip: truncated data for ${name}`);

    let data: Uint8Array;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      data = inflateSync(raw, { out: new Uint8Array(uncompSize) });
    } else {
      throw new Error(`unsupported compression method ${method} for ${name}`);
    }
    if (data.length !== uncompSize) {
      throw new Error(`corrupt zip: size mismatch for ${name}`);
    }
    if (crc32(data) !== crc) {
      throw new Error(`corrupt zip: CRC mismatch for ${name}`);
    }
    entries.push({ name, data });
  }
  return entries;
}

function header(size: number, write: (dv: DataView) => void): Uint8Array {
  const out = new Uint8Array(size);
  write(new DataView(out.buffer));
  return out;
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    // strToU8, not a global TextEncoder — Hermes only gained the web
    // encoding APIs recently; fflate's helper is portable everywhere.
    const name = strToU8(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const deflated = deflateSync(data);
    // Store when deflate doesn't help (already-compressed or tiny).
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = header(30, (dv) => {
      dv.setUint32(0, LOCAL_SIG, true);
      dv.setUint16(4, 20, true); // version needed
      dv.setUint16(6, 0x0800, true); // UTF-8 names
      dv.setUint16(8, method, true);
      dv.setUint16(10, DOS_TIME, true);
      dv.setUint16(12, DOS_DATE, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, payload.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
    });

    const localOffset = offset;
    const central = header(46, (dv) => {
      dv.setUint32(0, CENTRAL_SIG, true);
      dv.setUint16(4, 20, true); // version made by
      dv.setUint16(6, 20, true); // version needed
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, method, true);
      dv.setUint16(12, DOS_TIME, true);
      dv.setUint16(14, DOS_DATE, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, payload.length, true);
      dv.setUint32(24, data.length, true);
      dv.setUint16(28, name.length, true);
      // extra, comment, disk, internal attrs, external attrs all zero
      dv.setUint32(42, localOffset, true);
    });

    localParts.push(local, name, payload);
    centralParts.push(central, name);
    offset += 30 + name.length + payload.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = header(22, (dv) => {
    dv.setUint32(0, EOCD_SIG, true);
    dv.setUint16(8, entries.length, true);
    dv.setUint16(10, entries.length, true);
    dv.setUint32(12, centralSize, true);
    dv.setUint32(16, offset, true);
  });

  const parts = [...localParts, ...centralParts, eocd];
  const total = parts.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
