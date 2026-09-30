/**
 * An attachment drawn as an image. iOS and Android: React Native's image
 * decoders don't read SVG (ImageIO, UIImage and Android's decoders have no
 * SVG), so an .svg is drawn by react-native-svg, sized by a box that takes
 * the style; anything else is an ordinary image. The web and macOS draw
 * every image themselves (AttachmentImage.web.tsx, .macos.tsx).
 */
import { html } from "react-strict-dom";
import { SvgUri } from "react-native-svg";

export interface AttachmentImageProps {
  src: string;
  /** The attachment's file name, which says whether it's an SVG. */
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
  /** How it fills its box: cropped to cover it, or whole within it. */
  fit: "cover" | "contain";
}

export function AttachmentImage({ src, name, style, fit }: AttachmentImageProps) {
  if (!/\.svg$/i.test(name)) return <html.img src={src} alt="" style={style} />;
  return (
    <html.div style={style}>
      <SvgUri uri={src} width="100%" height="100%" preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"} />
    </html.div>
  );
}
