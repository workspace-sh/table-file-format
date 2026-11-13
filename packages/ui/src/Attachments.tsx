// Where an attachment's file can be shown from. The format stores only the
// filename (SPEC section 6) and leaves resolving it to the app, so the app
// supplies this: a filename in, a URL out, or nothing when it can't.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type AttachmentUrl = (fileName: string) => string | undefined;

const AttachmentsContext = createContext<AttachmentUrl>(() => undefined);

export function AttachmentsProvider({ value, children }: { value: AttachmentUrl; children: ReactNode }) {
  return <AttachmentsContext.Provider value={value}>{children}</AttachmentsContext.Provider>;
}

export function useAttachmentUrl(): AttachmentUrl {
  return useContext(AttachmentsContext);
}

/**
 * Files drawn as an image on the platform `os` (React Native's Platform.OS;
 * absent, a browser): what a browser draws and, on iOS and macOS, HEIC (what
 * an iPhone's camera keeps) and TIFF too, which their own image decoders
 * read. The platform is handed in, so this file loads where React Native
 * doesn't (Node, the web).
 */
export function isImageFile(fileName: string, os?: string): boolean {
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(fileName)) return true;
  return (os === "ios" || os === "macos") && /\.(heic|heif|tiff?)$/i.test(fileName);
}
