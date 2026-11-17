// An image attached on the web, made into the format it's kept in (#825,
// table-app's keptImageAs): drawn by the browser, then written as JPEG or
// PNG. A browser draws SVG, GIF, AVIF and BMP; HEIC and TIFF only Safari
// does. One the browser can't read is kept as it was chosen, and the
// caller says so.

import { keptImageAs } from "@workspace.sh/table-app";

/** An SVG is drawn this many pixels along its longer side: a 64-pixel icon would be blurred at the size of a card. */
const SVG_SIDE = 1024;
const JPEG_QUALITY = 0.9;

/** A decode that hasn't finished in this long won't: the file is kept as it was. */
const DECODE_MS = 10_000;

function withinTime<T>(work: Promise<T>): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("decode timed out")), DECODE_MS))]);
}

export interface KeptFile {
  /** The name it's kept under, before attachmentName makes it one of its own. */
  name: string;
  bytes: Uint8Array;
  /** The browser couldn't read the image, so it's kept as it was. */
  unread?: true;
}

export async function keptFile(file: File): Promise<KeptFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const as = keptImageAs(file.name);
  if (!as) return { name: file.name, bytes };
  const svg = /\.svg$/i.test(file.name);
  const blob = new Blob([bytes], { type: file.type || (svg ? "image/svg+xml" : "") });
  const url = URL.createObjectURL(blob);
  try {
    // A bitmap is decoded without being drawn on the page (an <img>'s decode() can wait on a GIF
    // indefinitely); an SVG isn't read that way, so it's drawn by an <img>.
    let source: CanvasImageSource;
    let width: number;
    let height: number;
    if (svg) {
      const img = new Image();
      img.src = url;
      await withinTime(img.decode());
      // Its own size, or none at all (an SVG with only a viewBox): drawn large, its shape kept.
      const ratio = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      width = ratio >= 1 ? SVG_SIDE : Math.round(SVG_SIDE * ratio);
      height = ratio >= 1 ? Math.round(SVG_SIDE / ratio) : SVG_SIDE;
      source = img;
    } else {
      const bitmap = await withinTime(createImageBitmap(blob));
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    }
    if (width === 0 || height === 0) throw new Error("no size");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas");
    // JPEG has no transparency: what's see-through in a photo is white, not black.
    if (as.type === "image/jpeg") {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, width, height);
    }
    g.drawImage(source, 0, 0, width, height);
    const written = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, as.type, JPEG_QUALITY));
    if (!written) throw new Error("not written");
    return { name: as.name, bytes: new Uint8Array(await written.arrayBuffer()) };
  } catch {
    return { name: file.name, bytes, unread: true };
  } finally {
    URL.revokeObjectURL(url);
  }
}
