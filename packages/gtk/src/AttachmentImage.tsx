// An attachment drawn as its image, when the app can say where its file
// is (table-ui/shared's AttachmentsProvider; table-app's attachmentPath on
// Linux) and it's a picture. GTK decodes the formats its image loaders
// know, SVG included through librsvg.

import * as Gdk from "@gtkx/gi/gdk";
import * as Gio from "@gtkx/gi/gio";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkPicture } from "@gtkx/jsx/gtk";
import { isImageFile, useAttachmentUrl } from "@workspace.sh/table-ui/shared";
import { useMemo } from "react";

/** A local path for an attachment URL: a plain path, or a file:// URL. Remote URLs aren't drawn. */
function localPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("file://")) return decodeURIComponent(url.slice("file://".length));
  return url.startsWith("/") ? url : undefined;
}

/**
 * The paintable for `fileName` at `size`, or null when it isn't an image
 * the app can find. An SVG is drawn at the size it's shown (an icon
 * paintable renders it there); loaded as a file, it's rasterised at its
 * own small size and then scaled up, blurred.
 */
export function useAttachmentPaintable(fileName: string, size: number): Gdk.Paintable | null {
  const path = localPath(useAttachmentUrl()(fileName));
  return useMemo(() => {
    if (!path || !isImageFile(fileName)) return null;
    const file = Gio.File.newForPath(path);
    // A file that isn't there, or isn't what its name says, is shown by name.
    if (!file.queryExists(null)) return null;
    try {
      // Twice the size, so it stays sharp on a 2x display too.
      return /\.svg$/i.test(fileName) ? Gtk.IconPaintable.newForFile(file, size, 2) : Gdk.Texture.newFromFile(file);
    } catch {
      return null;
    }
  }, [path, fileName, size]);
}

/** A picture drawn from a paintable, fitted inside `width` × `height`. */
export function AttachmentPicture({ paintable, fileName, width, height }: { paintable: Gdk.Paintable; fileName: string; width: number; height: number }) {
  return (
    <GtkPicture
      paintable={paintable}
      contentFit={Gtk.ContentFit.CONTAIN}
      canShrink
      widthRequest={width}
      heightRequest={height}
      valign={Gtk.Align.CENTER}
      alternativeText={fileName}
    />
  );
}

/** The picture for `fileName`, or null when it isn't an image the app can find. */
export function AttachmentImage({ fileName, width, height }: { fileName: string; width: number; height: number }) {
  const paintable = useAttachmentPaintable(fileName, Math.max(width, height));
  return paintable ? <AttachmentPicture paintable={paintable} fileName={fileName} width={width} height={height} /> : null;
}
