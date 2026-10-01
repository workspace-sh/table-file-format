/**
 * macOS: a link the pointer clicks, as on the web, opened by the system
 * (React Strict DOM's `<a>` doesn't follow its `href` on native).
 */
import { Linking } from "react-native";
import { html } from "react-strict-dom";
import { OpenButton, type CellLinkProps } from "./cellLinkParts";

export type { CellLinkProps } from "./cellLinkParts";

export function CellLink({ href, onOpen, label, style, children }: CellLinkProps) {
  if (onOpen) return <OpenButton onOpen={onOpen} style={style}>{children}</OpenButton>;
  return (
    <html.span
      role="link"
      aria-label={label}
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        if (href) void Linking.openURL(href).catch(() => {});
      }}
      style={style}
    >
      {children}
    </html.span>
  );
}
