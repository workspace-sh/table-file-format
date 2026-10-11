/**
 * A menu of actions where the pointer was: a row's or a column's, opened by
 * a right-click (RowActions on the web, RowActions.macos on the Mac).
 */
import { useEffect, type ReactElement } from "react";
import { html, css } from "react-strict-dom";
import type { RowAction } from "../controlSlots";
import { Portal } from "./Portal";

/**
 * Whether the browser's window size can be read, to keep the menu on
 * screen. React Native has a `window` (its global) without innerWidth, so
 * the menu there keeps its unclamped position rather than NaN.
 */
function hasWindowSize(): boolean {
  return typeof window !== "undefined" && typeof window.innerWidth === "number";
}

export function ActionsMenu({ actions, at, onClose }: { actions: RowAction[]; at: { x: number; y: number }; onClose: () => void }): ReactElement {
  useEffect(() => {
    // React Native has a `window` (its global), but no addEventListener.
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Portal>
      <html.div style={styles.backdrop} onClick={onClose} onContextMenu={(e: { preventDefault: () => void }) => { e.preventDefault(); onClose(); }} />
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
              onClose();
              action.onSelect();
            }}
          >
            {action.label}
          </html.button>
        ))}
      </html.div>
    </Portal>
  );
}

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
