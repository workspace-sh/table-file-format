/**
 * Default (web, macOS): a card over a dimmed page, its title and the
 * file it edits at the top with a close button, what it holds in the
 * middle, and its buttons along the foot. iOS and Android present the
 * same as the system's sheets (`Sheet.ios.tsx`, `Sheet.android.tsx`).
 * A host can draw the card on a native material (PanelSurface): the macOS
 * app draws it on Liquid Glass.
 */
import { useContext, type ReactElement } from "react";
import { PanelSurface } from "../panelSurface";
import { html, css } from "react-strict-dom";
import type { SheetProps } from "../controlSlots";
import { passThrough } from "./passThrough";
import { Portal } from "./Portal";

export function Sheet({ title, subtitle, cancel, confirm, status, dismissible, onDismiss, children }: SheetProps): ReactElement {
  const Surface = useContext(PanelSurface);
  const card = (
    <>
      <html.div style={styles.header}>
        <html.div style={styles.headerLeft}>
          <html.span style={styles.title}>{title}</html.span>
          {subtitle !== undefined && <html.span style={styles.subtitle}>{subtitle}</html.span>}
        </html.div>
        <html.button style={styles.closeButton} onClick={cancel?.onPress ?? onDismiss}>
          ✕
        </html.button>
      </html.div>
      {children}
      <html.div style={styles.footer}>
        <html.span style={styles.footerHint}>{status}</html.span>
        <html.div style={styles.buttonRow}>
          {cancel && (
            <html.button style={styles.button} onClick={cancel.onPress}>
              {cancel.label}
            </html.button>
          )}
          {confirm && (
            <html.button
              disabled={confirm.disabled}
              style={[styles.button, !confirm.disabled && styles.primary]}
              onClick={confirm.onPress}
            >
              {confirm.label}
            </html.button>
          )}
        </html.div>
      </html.div>
    </>
  );
  return (
    <Portal>
      {/* Backdrop sibling: a tap outside the card closes it, when that
          loses nothing. */}
      <html.button
        onClick={() => {
          if (dismissible) onDismiss();
        }}
        style={styles.backdrop}
      />
      {/* The wrapper centres the card and lets taps around it through to
          the backdrop (passThrough). */}
      <html.div style={[styles.modalWrapper, passThrough]}>
        <html.div style={[styles.modal, Surface && styles.modalOnSurface]}>
          {Surface ? <Surface radius={CARD_RADIUS}>{card}</Surface> : card}
        </html.div>
      </html.div>
    </Portal>
  );
}

/** The card's corners: StyleX needs the literal below too. */
const CARD_RADIUS = 10;

const styles = css.create({
  /**
   * Dim backdrop covering the viewport. html.button so the press
   * handler works on both web and native (RSD maps html.button →
   * Pressable on RN). Rendered as a SIBLING of the modal inside the
   * Portal, not a parent — that way modal clicks hit the modal
   * directly and never reach the backdrop, no `stopPropagation`
   * dance needed (which doesn't behave identically on RN anyway).
   */
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    zIndex: 99,
    borderWidth: 0,
    padding: 0,
    cursor: "default",
  },
  modalWrapper: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    width: "90%",
    maxWidth: 720,
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    overflow: "hidden",
    pointerEvents: "auto",
    position: "relative",
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
  },
  // On a host's material (PanelSurface): its fill and edge, not the card's.
  modalOnSurface: {
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  subtitle: {
    fontSize: 11,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  closeButton: {
    paddingInline: 8,
    paddingBlock: 4,
    fontSize: 16,
    backgroundColor: "transparent",
    borderWidth: 0,
    cursor: "pointer",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  footer: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 16,
    paddingBlock: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    gap: 8,
  },
  footerHint: {
    fontSize: 11,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  buttonRow: {
    display: "flex",
    flexDirection: "row",
    gap: 8,
  },
  button: {
    paddingInline: 12,
    paddingBlock: 6,
    fontSize: 12,
    fontWeight: "500",
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  primary: {
    backgroundColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    borderColor: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
    color: "#ffffff",
  },
});
