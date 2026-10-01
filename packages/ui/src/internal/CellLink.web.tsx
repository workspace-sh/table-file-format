/**
 * Web: a link, as the browser draws one, or a button for a link within
 * the app (a related row). A click on it opens it, not the cell; anywhere
 * else in the cell selects it. `CellLink.macos.tsx` and `CellLink.tsx`
 * serve native.
 */
import { html } from "react-strict-dom";
import { OpenButton, type CellLinkProps } from "./cellLinkParts";

export type { CellLinkProps } from "./cellLinkParts";


export function CellLink({ href, onOpen, external, style, children }: CellLinkProps) {
  if (onOpen) return <OpenButton onOpen={onOpen} style={style}>{children}</OpenButton>;
  return (
    <html.a
      href={href}
      target={external ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
      style={style}
    >
      {children}
    </html.a>
  );
}
