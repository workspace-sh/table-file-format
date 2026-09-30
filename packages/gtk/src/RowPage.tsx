// A row's page on GTK: its long-form markdown body (SPEC section 7,
// `bodies/{id}.md`), edited as text in a dialog, as table-ui's BodyEditor
// does on the web. Closing with changes asks first; nothing is saved
// until Save.

import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { AdwAlertDialog, AdwDialog, AdwHeaderBar, AdwToolbarView, AdwWindowTitle } from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkLabel, GtkScrolledWindow, GtkTextBuffer, GtkTextView } from "@gtkx/jsx/gtk";
import { useState } from "react";

export interface RowPageProps {
  rowId: string;
  /** The row as people name it (table-app's rowTitleFor). */
  rowTitle: string;
  /** The page's markdown; empty when the row has none yet. */
  content: string;
  /** Save the page; empty content removes it. */
  onSave: (content: string) => void;
  onClose: () => void;
}

export function RowPage({ rowId, rowTitle, content, onSave, onClose }: RowPageProps) {
  const [draft, setDraft] = useState(content);
  const [confirming, setConfirming] = useState(false);
  const dirty = draft !== content;
  const save = () => {
    onSave(draft);
    onClose();
  };

  return (
    <AdwDialog
      title={rowTitle}
      contentWidth={720}
      contentHeight={560}
      // With changes, closing (Escape, the close button) asks first.
      canClose={!dirty}
      onCloseAttempt={() => setConfirming(true)}
      onClosed={onClose}
    >
      <AdwToolbarView
        topBar={<AdwHeaderBar titleWidget={<AdwWindowTitle title={rowTitle} subtitle={`bodies/${rowId}.md${content.length === 0 ? " · new" : ""}`} />} />}
        bottomBar={
          <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={12}>
            <GtkLabel label={dirty ? "Unsaved changes" : "No changes"} hexpand xalign={0} cssClasses={["dim-label"]} />
            <GtkButton label="Save" cssClasses={["suggested-action"]} sensitive={dirty} onClicked={save} />
          </GtkBox>
        }
      >
        <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
          <GtkTextView wrapMode={Gtk.WrapMode.WORD_CHAR} monospace topMargin={12} bottomMargin={12} leftMargin={16} rightMargin={16}>
            <GtkTextBuffer text={content} onChanged={(buffer) => setDraft(buffer.text)} />
          </GtkTextView>
        </GtkScrolledWindow>
      </AdwToolbarView>
      {confirming ? (
        <AdwAlertDialog
          heading="Discard changes to this page?"
          body="What you've typed since opening it isn't saved."
          closeResponse="keep"
          defaultResponse="keep"
          responses={[
            { id: "keep", label: "Keep Editing" },
            { id: "save", label: "Save", appearance: Adw.ResponseAppearance.SUGGESTED },
            { id: "discard", label: "Discard", appearance: Adw.ResponseAppearance.DESTRUCTIVE },
          ]}
          onResponse={(response) => {
            setConfirming(false);
            if (response === "save") save();
            if (response === "discard") onClose();
          }}
        />
      ) : null}
    </AdwDialog>
  );
}
