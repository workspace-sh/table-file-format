// A row's page on GTK: its long-form markdown body (SPEC section 7,
// `bodies/{id}.md`), edited as text in a dialog, as table-ui's BodyEditor
// does on the web. What's typed is saved a moment after each pause; Done
// closes. Wiping a page's text isn't saved as typed (an empty page is no
// page): closing asks before deleting it.

import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { AdwAlertDialog, AdwDialog, AdwHeaderBar, AdwToolbarView, AdwWindowTitle } from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkLabel, GtkScrolledWindow, GtkTextBuffer, GtkTextView } from "@gtkx/jsx/gtk";
import { pageSave } from "@workspace.sh/table-ui/shared";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long typing pauses before it's saved. */
const SAVE_AFTER_MS = 700;

export interface RowPageProps {
  rowId: string;
  /** The row as people name it (table-app's rowTitleFor). */
  rowTitle: string;
  /** The page's markdown; empty when the row has none yet. */
  content: string;
  /** Save the page; empty content removes it. Called as it's typed. */
  onSave: (content: string) => void;
  onClose: () => void;
}

export function RowPage({ rowId, rowTitle, content, onSave, onClose }: RowPageProps) {
  // The buffer starts from the page as opened; saves coming back as
  // `content` must not reset it under the cursor.
  const [initial] = useState(content);
  const [draft, setDraft] = useState(content);
  // What's been saved, as this dialog knows it.
  const [saved, setSaved] = useState(content);
  const [confirming, setConfirming] = useState(false);
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
    // Now, not on the next render: Done saves, then the dialog closes, which saves.
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

  const done = () => {
    if (pageSave(latest.current.saved, latest.current.draft) === "ask") {
      setConfirming(true);
      return;
    }
    flush();
    onClose();
  };

  const status = next === "save" ? "Saving…" : next === "ask" ? "Empty, not saved" : saved === "" ? "" : "Saved";

  return (
    <AdwDialog
      title={rowTitle}
      contentWidth={720}
      contentHeight={560}
      // Closing (Escape, the close button) saves and closes, unless that
      // would delete the page: then it asks.
      canClose={next !== "ask"}
      onCloseAttempt={() => setConfirming(true)}
      onClosed={() => {
        flush();
        onClose();
      }}
    >
      <AdwToolbarView
        topBar={<AdwHeaderBar titleWidget={<AdwWindowTitle title={rowTitle} subtitle={`bodies/${rowId}.md${content.length === 0 ? " · new" : ""}`} />} />}
        bottomBar={
          <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12}>
            <GtkLabel label={status} hexpand xalign={0} cssClasses={["dim-label"]} />
            <GtkButton label="Done" cssClasses={["suggested-action"]} onClicked={done} />
          </GtkBox>
        }
      >
        <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
          <GtkTextView wrapMode={Gtk.WrapMode.WORD_CHAR} monospace topMargin={12} bottomMargin={12} leftMargin={16} rightMargin={16}>
            <GtkTextBuffer text={initial} onChanged={(buffer) => setDraft(buffer.text)} />
          </GtkTextView>
        </GtkScrolledWindow>
      </AdwToolbarView>
      {confirming ? (
        <AdwAlertDialog
          heading="Delete this page?"
          body={`Its text is gone, so closing deletes bodies/${rowId}.md.`}
          closeResponse="keep"
          defaultResponse="keep"
          responses={[
            { id: "keep", label: "Keep Editing" },
            { id: "delete", label: "Delete Page", appearance: Adw.ResponseAppearance.DESTRUCTIVE },
          ]}
          onResponse={(response) => {
            setConfirming(false);
            if (response !== "delete") return;
            latest.current.onSave("");
            onClose();
          }}
        />
      ) : null}
    </AdwDialog>
  );
}
