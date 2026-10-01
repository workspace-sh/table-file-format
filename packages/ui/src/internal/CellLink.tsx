/**
 * Touch default (iOS, Android). A tap on a cell selects it, a second
 * edits it, as for any cell: the value is text, not a link that would take
 * the tap. The link opens from its own button beside it, a target of its
 * own (28 pt, the HIG's least).
 */
import { Linking } from "react-native";
import { html, css } from "react-strict-dom";
import type { CellLinkProps } from "./CellLink.web";

export type { CellLinkProps } from "./CellLink.web";

export function CellLink({ href, label, style, children }: CellLinkProps) {
  return (
    <html.div style={styles.row}>
      <html.span style={[style, styles.text]}>{children}</html.span>
      <html.button
        aria-label={label}
        onClick={(e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          void Linking.openURL(href).catch(() => {});
        }}
        style={styles.open}
      >
        ↗
      </html.button>
    </html.div>
  );
}

const styles = css.create({
  row: { display: "flex", flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 },
  text: { flexShrink: 1, minWidth: 0 },
  open: {
    flexShrink: 0,
    width: 28,
    height: 28,
    marginBlock: -6,
    borderWidth: 0,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    backgroundColor: "transparent",
    color: { default: "#1d4ed8", "@media (prefers-color-scheme: dark)": "#8ab4ff" },
  },
});
