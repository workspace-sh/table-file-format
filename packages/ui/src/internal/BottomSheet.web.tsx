/**
 * Web variant — Vite picks this. Metro picks `BottomSheet.tsx`.
 *
 * CSS-transition slide-up sheet. Same prop surface as the native
 * variant (`visible`, `onDismiss`, `title`, optional
 * `dismissOnBackdrop`).
 *
 * Uses our own `Portal` (which on web maps to React's `createPortal`
 * into `document.body`) to escape any clipping ancestor.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";
import { Portal } from "./Portal";

const SLIDE_MS = 220;
const BACKDROP_ALPHA = 0.5;

export interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  dismissOnBackdrop?: boolean;
  children?: ReactNode;
}

const styles = css.create({
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0)",
    transitionProperty: "background-color",
    transitionDuration: `${SLIDE_MS}ms`,
    cursor: "pointer",
  },
  backdropVisible: {
    backgroundColor: `rgba(0, 0, 0, ${BACKDROP_ALPHA})`,
  },
  sheet: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "85%",
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    transform: "translateY(100%)",
    transitionProperty: "transform",
    transitionDuration: `${SLIDE_MS}ms`,
    transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
    boxShadow: "0 -8px 24px rgba(0, 0, 0, 0.18)",
  },
  sheetVisible: {
    transform: "translateY(0)",
  },
  header: {
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    flexDirection: "row",
    alignItems: "center",
    display: "flex",
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  close: {
    paddingInline: 8,
    paddingBlock: 4,
    fontSize: 13,
    backgroundColor: "transparent",
    borderWidth: 0,
    cursor: "pointer",
    color: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  body: {
    paddingInline: 16,
    paddingBlock: 16,
  },
});

export function BottomSheet({
  visible,
  onDismiss,
  title,
  dismissOnBackdrop = true,
  children,
}: BottomSheetProps) {
  // Two-phase mount so the slide-up animation can play on appear.
  // First render: mounted but off-screen (transform translateY 100%).
  // Next tick: flip `entered` true → transition kicks in.
  const [mounted, setMounted] = useState(visible);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted) return null;

  return (
    <Portal>
      <html.div
        style={[styles.backdrop, entered && styles.backdropVisible]}
        onClick={dismissOnBackdrop ? onDismiss : undefined}
      />
      <html.div style={[styles.sheet, entered && styles.sheetVisible]}>
        {title && (
          <html.div style={styles.header}>
            <html.span style={styles.title}>{title}</html.span>
            <html.button onClick={onDismiss} style={styles.close}>
              Done
            </html.button>
          </html.div>
        )}
        <html.div style={styles.body}>{children}</html.div>
      </html.div>
    </Portal>
  );
}
