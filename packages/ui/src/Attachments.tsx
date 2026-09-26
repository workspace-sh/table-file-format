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

/** Files a browser can draw as an image. */
export function isImageFile(fileName: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(fileName);
}
