// An image attached on the web, made into the format it's kept in (#825,
// table-app's keptImageAs): a HEIC, HEIF or TIFF photo becomes a JPEG.
// The browser decodes it where it can (Safari reads all three); elsewhere
// a decoder is loaded for it, only when such a file is attached: libheif
// (heic-to) for HEIC and HEIF, UTIF for TIFF. One that still can't be
// read is kept as it was chosen, and the caller says so.

import { keptImageAs } from "@workspace.sh/table-app";

const JPEG_QUALITY = 0.9;
/** A decode that hasn't finished in this long won't: the file is kept as it was. */
const DECODE_MS = 30_000;

function withinTime<T>(work: Promise<T>): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("decode timed out")), DECODE_MS))]);
}

export interface KeptFile {
  /** The name it's kept under, before attachmentName makes it one of its own. */
  name: string;
  bytes: Uint8Array;
  /** It couldn't be read, so it's kept as it was. */
  unread?: true;
}

export async function keptFile(file: File): Promise<KeptFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const as = keptImageAs(file.name);
  if (!as) return { name: file.name, bytes };
  try {
    const jpeg = await withinTime(asJpeg(file, bytes));
    return { name: as.name, bytes: new Uint8Array(await jpeg.arrayBuffer()) };
  } catch {
    return { name: file.name, bytes, unread: true };
  }
}

async function asJpeg(file: File, bytes: Uint8Array): Promise<Blob> {
  // The browser's own decoder first: Safari's reads HEIC, HEIF and TIFF.
  try {
    return await jpegOf(await createImageBitmap(file));
  } catch {
    // Not this browser's to read: the format's own decoder.
  }
  if (/\.(heic|heif)$/i.test(file.name)) {
    const { heicTo } = await import("heic-to");
    return heicTo({ blob: file, type: "image/jpeg", quality: JPEG_QUALITY });
  }
  const UTIF = (await import("utif2")).default;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const [page] = UTIF.decode(buffer);
  if (!page) throw new Error("no image in the TIFF");
  UTIF.decodeImage(buffer, page);
  const rgba = UTIF.toRGBA8(page);
  const width = page.width as number;
  const height = page.height as number;
  return jpegOf(await createImageBitmap(new ImageData(Uint8ClampedArray.from(rgba), width, height)));
}

/** A decoded picture written as JPEG: what's see-through is white, as JPEG has no transparency. */
async function jpegOf(picture: ImageBitmap): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = picture.height;
  const g = canvas.getContext("2d");
  if (!g || canvas.width === 0 || canvas.height === 0) throw new Error("nothing to draw");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(picture, 0, 0);
  picture.close();
  const written = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!written) throw new Error("not written");
  return written;
}
