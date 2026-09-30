/** Web: the browser draws every image, SVG included. */
import { html } from "react-strict-dom";
import type { AttachmentImageProps } from "./AttachmentImage";

export function AttachmentImage({ src, style }: AttachmentImageProps) {
  return <html.img src={src} alt="" style={style} />;
}
