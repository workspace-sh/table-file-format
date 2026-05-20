import { useEffect, useState } from "react";
import { html, css } from "react-strict-dom";
import { Portal } from "./internal/Portal";

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
    // Pointer-events: none so the wrapper passes clicks through to the
    // backdrop underneath; the modal child re-enables them via
    // `pointer-events: auto`.
    pointerEvents: "none",
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
  textarea: {
    flex: 1,
    minHeight: 360,
    padding: 16,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: 1.5,
    borderWidth: 0,
    outlineStyle: "none",
    resize: "none",
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
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

interface BodyEditorProps {
  rowId: string;
  rowTitle: string;
  content: string;
  onSave: (content: string) => void;
  onClose: () => void;
}

export function BodyEditor({ rowId, rowTitle, content, onSave, onClose }: BodyEditorProps) {
  const [draft, setDraft] = useState(content);
  const dirty = draft !== content;
  const isNew = content.length === 0;

  // Web-only: escape key dismisses when not dirty. Guarded by document
  // check so the same code is a no-op on RN (where there's no keyboard
  // escape key in the same sense — a hardware back button handler
  // would be platform-specific work for native, deferred).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dirty) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dirty, onClose]);

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Portal>
      {/* Backdrop sibling — tap outside the modal closes it (only when
          clean; dirty edits stay safe). */}
      <html.button
        onClick={() => {
          if (!dirty) onClose();
        }}
        style={styles.backdrop}
      />
      {/* Modal wrapper centers the modal and is itself
          pointer-events: none so clicks pass through to the backdrop
          on the empty area around the modal. */}
      <html.div style={styles.modalWrapper}>
        <html.div style={styles.modal}>
          <html.div style={styles.header}>
            <html.div style={styles.headerLeft}>
              <html.span style={styles.title}>{rowTitle || rowId}</html.span>
              <html.span style={styles.subtitle}>
                bodies/{rowId}.md{isNew ? " · new" : ""}
              </html.span>
            </html.div>
            <html.button style={styles.closeButton} onClick={onClose}>
              ✕
            </html.button>
          </html.div>
          <html.textarea
            value={draft}
            onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
            placeholder="Long-form markdown body…"
            style={styles.textarea}
          />
          <html.div style={styles.footer}>
            <html.span style={styles.footerHint}>
              {dirty ? "Unsaved changes" : "No changes"}
            </html.span>
            <html.div style={styles.buttonRow}>
              <html.button style={styles.button} onClick={onClose}>
                {dirty ? "Discard" : "Close"}
              </html.button>
              <html.button
                disabled={!dirty}
                style={[styles.button, dirty && styles.primary]}
                onClick={save}
              >
                Save
              </html.button>
            </html.div>
          </html.div>
        </html.div>
      </html.div>
    </Portal>
  );
}
