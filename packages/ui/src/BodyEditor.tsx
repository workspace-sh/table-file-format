import { useEffect, useState } from "react";
import { html, css } from "react-strict-dom";

const styles = css.create({
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
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

  useEffect(() => {
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
    <html.div
      style={styles.backdrop}
      onClick={() => {
        if (!dirty) onClose();
      }}
    >
      <html.div
        style={styles.modal}
        onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}
      >
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
  );
}
