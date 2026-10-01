/**
 * Web: a link, as the browser draws one. A click on it opens it, not the
 * cell; anywhere else in the cell selects it. `CellLink.macos.tsx` and
 * `CellLink.tsx` serve native.
 */
import type { ReactNode } from "react";
import { html } from "react-strict-dom";

export interface CellLinkProps {
  href: string;
  /** Opens elsewhere (a web page), not in a mail or phone app. */
  external: boolean;
  /** What the link is, for assistive technology ("Open", "Email", "Call"). */
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
  children: ReactNode;
}

export function CellLink({ href, external, style, children }: CellLinkProps) {
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
