/**
 * macOS: a link the pointer clicks, as on the web, opened by the system
 * (React Strict DOM's `<a>` doesn't follow its `href` on native).
 */
import { Linking } from "react-native";
import { html } from "react-strict-dom";
import type { CellLinkProps } from "./CellLink.web";

export type { CellLinkProps } from "./CellLink.web";

export function CellLink({ href, label, style, children }: CellLinkProps) {
  return (
    <html.span
      role="link"
      aria-label={label}
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        void Linking.openURL(href).catch(() => {});
      }}
      style={style}
    >
      {children}
    </html.span>
  );
}
