/**
 * Pointer default (web, and macOS: Metro tries `.macos`, `.native`, then
 * this, never `.ios`). Right-click a row for its actions in a menu where
 * the pointer is. iOS and Android have their own (`RowActions.ios.tsx`,
 * `RowActions.android.tsx`), and a host can pass another
 * (PlatformControlsProvider).
 *
 * Deleting lives here rather than as a control in every row, where it
 * would be clutter and easy to hit.
 */
import { cloneElement, useEffect, useState, type ReactElement } from "react";
import { html, css } from "react-strict-dom";
import type { RowActionsProps } from "../controlSlots";
import { Portal } from "./Portal";

type ContextMenuEvent = { preventDefault: () => void; clientX: number; clientY: number };

/**
 * Whether the browser's window size can be read, to keep the menu on
 * screen. React Native has a `window` (its global) without innerWidth, so
 * the menu there keeps its unclamped position rather than NaN.
 */
function hasWindowSize(): boolean {
  return typeof window !== "undefined" && typeof window.innerWidth === "number";
}

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    // React Native has a `window` (its global), but no addEventListener.
    if (!at || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAt(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at]);
  if (actions.length === 0) return children;
  const row = cloneElement(children as ReactElement<{ onContextMenu?: (e: ContextMenuEvent) => void }>, {
    onContextMenu: (e: ContextMenuEvent) => {
      e.preventDefault();
      setAt({ x: e.clientX, y: e.clientY });
    },
  });
  return (
    <>
      {row}
      {at && (
        <Portal>
          <html.div style={styles.backdrop} onClick={() => setAt(null)} onContextMenu={(e: { preventDefault: () => void }) => { e.preventDefault(); setAt(null); }} />
          <html.div
            role="menu"
            style={[
              styles.menu,
              styles.menuAt(
                !hasWindowSize() ? at.y : Math.min(at.y, window.innerHeight - 180),
                !hasWindowSize() ? at.x : Math.min(at.x, window.innerWidth - 190),
              ),
            ]}
          >
            {actions.map((action) => (
              <html.button
                key={action.id}
                role="menuitem"
                style={[styles.item, action.destructive && styles.danger]}
                onClick={() => {
                  setAt(null);
                  action.onSelect();
                }}
              >
                {action.label}
              </html.button>
            ))}
          </html.div>
        </Portal>
      )}
    </>
  );
}

RowActions.gesture = "Right-click a row";

const styles = css.create({
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 49,
    backgroundColor: "transparent",
  },
  menu: {
    position: "fixed",
    zIndex: 50,
    minWidth: 180,
    paddingBlock: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
    borderColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#2c2c31" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1f" },
  },
  menuAt: (top: number, left: number) => ({ top, left }),
  item: {
    textAlign: "start",
    paddingInline: 12,
    paddingBlock: 6,
    fontSize: 13,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#2a2a2e" },
    },
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  danger: {
    color: { default: "#c00", "@media (prefers-color-scheme: dark)": "#ff6b6b" },
  },
});
