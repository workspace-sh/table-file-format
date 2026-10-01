// What every platform's CellLink shares: its props, and the button the
// pointer platforms (web, macOS) use for a link within the app.

import type { ReactNode } from "react";
import { html } from "react-strict-dom";

export interface CellLinkProps {
  /** Where it goes: an address (a web page, mail, a phone call), or `onOpen` for somewhere in the app. */
  href?: string;
  onOpen?: () => void;
  /** Opens elsewhere (a web page), not in a mail or phone app. */
  external?: boolean;
  /** What the link is, for assistive technology ("Open", "Email", "Call"). */
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
  children: ReactNode;
}

/** A link within the app, as a button (a related row): the pointer's way, on the web and macOS. */
export function OpenButton({ onOpen, style, children }: { onOpen: () => void; style?: CellLinkProps["style"]; children: ReactNode }) {
  return (
    <html.button
      style={style}
      onClick={(e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {children}
    </html.button>
  );
}
