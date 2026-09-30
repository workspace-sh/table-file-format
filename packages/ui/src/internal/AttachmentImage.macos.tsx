/**
 * macOS: React Native's image path draws SVG too, through the patched
 * decoder that hands SVG to NSImage (apps/desktop/patches). react-native-svg
 * draws nothing on react-native-macos under the New Architecture
 * (software-mansion/react-native-svg#2869), so it isn't used here.
 */
import { html } from "react-strict-dom";
import type { AttachmentImageProps } from "./AttachmentImage";

export function AttachmentImage({ src, style }: AttachmentImageProps) {
  return <html.img src={src} alt="" style={style} />;
}
