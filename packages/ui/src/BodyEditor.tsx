import { useCallback, useState } from "react";
import { html, css } from "react-strict-dom";
import { Sheet } from "./PlatformControls";
import { useEscape } from "./internal/useEscape";

const styles = css.create({
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

  // Escape closes it when there's nothing unsaved (internal/useEscape: the
  // document on the web, the text input on macOS, nothing on touch screens).
  const closeIfClean = useCallback(() => {
    if (!dirty) onClose();
  }, [dirty, onClose]);
  const escape = useEscape(closeIfClean);

  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    // The platform's sheet (PlatformControls): a card over the page on the
    // web and macOS, the system's sheet on a phone.
    <Sheet
      title={rowTitle || rowId}
      subtitle={`bodies/${rowId}.md${isNew ? " · new" : ""}`}
      cancel={{ label: dirty ? "Discard" : "Close", onPress: onClose }}
      confirm={{ label: "Save", onPress: save, disabled: !dirty }}
      status={dirty ? "Unsaved changes" : "No changes"}
      // Closing by a tap outside, a swipe or Escape loses nothing: only when clean.
      dismissible={!dirty}
      onDismiss={onClose}
    >
      <html.textarea
        {...escape.inputProps}
        dir="auto"
        value={draft}
        onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
        placeholder="Long-form markdown body…"
        style={styles.textarea}
      />
    </Sheet>
  );
}
