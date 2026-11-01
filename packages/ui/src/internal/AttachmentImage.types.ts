// What every AttachmentImage variant takes, in a file of its own: with
// platform suffixes resolved, "./AttachmentImage" from a variant can mean the variant itself.

export interface AttachmentImageProps {
  src: string;
  /** The attachment's file name, which says whether it's an SVG. */
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
  /** How it fills its box: cropped to cover it, or whole within it. */
  fit: "cover" | "contain";
}
