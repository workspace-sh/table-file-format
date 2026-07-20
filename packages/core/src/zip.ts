import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal zip read/write for the `.table.zip` transport convention
 * (SPEC section 13). Deliberately zero-dependency — the format's
 * pitch is "implementable in an afternoon", and its reference
 * library should not pull an archive stack for two fixed layouts.
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

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
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
  const buf = toBuffer(source);
  const maxTotal = opts?.maxTotalBytes ?? ZIP_MAX_TOTAL_BYTES;

  // End-of-central-directory: scan backwards over the trailing
  // comment space (max 65535 + 22 bytes).
  let eocd = -1;
  const scanFrom = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip archive (no end-of-central-directory)");

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("zip64 archives are not supported");
  }

  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  let declaredTotal = 0;

  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) {
      throw new Error("corrupt zip: bad central directory entry");
    }
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
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
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`corrupt zip: bad local header for ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (raw.length !== compSize) throw new Error(`corrupt zip: truncated data for ${name}`);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      data = inflateRawSync(raw, { maxOutputLength: uncompSize });
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

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const data = toBuffer(entry.data);
    const crc = crc32(data);
    const deflated = deflateRawSync(data);
    // Store when deflate doesn't help (already-compressed or tiny).
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk, internal attrs, external attrs all zero
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, payload);
    centralParts.push(central, name);
    offset += 30 + name.length + payload.length;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
