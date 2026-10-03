import { useCallback, useEffect, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import { Sheet } from "./PlatformControls";
import { confirmDestructive } from "./internal/confirm";
import { useEscape } from "./internal/useEscape";
import { pageSave } from "./pageEdit";

/** How long typing pauses before it's saved. */
const SAVE_AFTER_MS = 700;

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

/**
 * A row's page. What's typed is saved as it's typed, a moment after each
 * pause, as Notes and Docs do: Done closes, and there's nothing to
 * discard. The one thing it won't do as you type is delete: a page wiped
 * of its text isn't saved (an empty page is no page), and closing asks
 * first.
 */
export function BodyEditor(props: BodyEditorProps) {
  // A fresh editor for each page, so one page's text and timer never carry
  // into the next. Hosts key it by table as well (a row id is per table).
  return <PageEditor key={props.rowId} {...props} />;
}

function PageEditor({ rowId, rowTitle, content, onSave, onClose }: BodyEditorProps) {
  const [draft, setDraft] = useState(content);
  // What's been saved, as this editor knows it.
  const [saved, setSaved] = useState(content);
  const isNew = content.length === 0;
  const next = pageSave(saved, draft);

  // Read by the timer and on unmount, which see the latest without re-running.
  const latest = useRef({ saved, draft, onSave });
  latest.current = { saved, draft, onSave };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { saved, draft, onSave } = latest.current;
    if (pageSave(saved, draft) !== "save") return;
    onSave(draft);
    // Now, not on the next render: closing saves, then unmounts, which saves.
    latest.current.saved = draft;
    setSaved(draft);
  }, []);

  useEffect(() => {
    if (next !== "save") return;
    timer.current = setTimeout(flush, SAVE_AFTER_MS);
    return () => clearTimeout(timer.current);
  }, [draft, next, flush]);

  // Closed some other way (the app moved on): keep what was typed.
  useEffect(() => flush, [flush]);

  const close = useCallback(() => {
    if (pageSave(latest.current.saved, latest.current.draft) !== "ask") {
      flush();
      onClose();
      return;
    }
    void confirmDestructive({
      title: "Delete this page?",
      message: `Its text is gone, so closing deletes bodies/${rowId}.md.`,
      confirm: "Delete Page",
      cancel: "Keep Editing",
    }).then((yes) => {
      if (!yes) return;
      latest.current.onSave("");
      onClose();
    });
  }, [flush, onClose, rowId]);

  // Escape closes it, as Done does (internal/useEscape: the document on the
  // web, the text input on macOS, nothing on touch screens).
  const escape = useEscape(close);

  return (
    // The platform's sheet (PlatformControls): a card over the page on the
    // web and macOS, the system's sheet on a phone.
    <Sheet
      title={rowTitle || rowId}
      subtitle={`bodies/${rowId}.md${isNew ? " · new" : ""}`}
      confirm={{ label: "Done", onPress: close }}
      status={next === "save" ? "Saving…" : next === "ask" ? "Empty, not saved" : saved === "" ? undefined : "Saved"}
      // A swipe or a tap outside closes it, saving, unless it would delete
      // the page: then it stays, and a swipe asks (onDismiss).
      dismissible={next !== "ask"}
      onDismiss={close}
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
