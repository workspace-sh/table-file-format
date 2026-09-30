// The sidebar's Files side, and a file shown from it: each .table as it is
// on disk, its folders and files from table-app's filesTree (the tree the
// web and macOS draw), and a file opened as the text saving writes, or an
// attachment's picture.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { AdwHeaderBar, AdwStatusPage, AdwToolbarView, AdwWindowTitle } from "@gtkx/jsx/adw";
import { GtkBox, GtkImage, GtkLabel, GtkListBox, GtkListBoxRow, GtkScrolledWindow, GtkTextBuffer, GtkTextView } from "@gtkx/jsx/gtk";
import type { FilesTreeEntry, ShownFile } from "@workspace.sh/table-app";
import { AttachmentImage } from "@workspace.sh/table-gtk";

/** A file on the Files side: which bundle, and its path inside it (table-app's). */
export type { ShownFile };

const INDENT = 14;

export function FilesSidebar({
  entries,
  shown,
  onToggleDir,
  onShowFile,
}: {
  entries: FilesTreeEntry[];
  shown: ShownFile | null;
  /** A folder opened or closed, by `bundle/path`. */
  onToggleDir: (id: string, open: boolean) => void;
  onShowFile: (file: ShownFile) => void;
}) {
  const selected = entries.findIndex((e) => e.kind === "file" && shown !== null && e.bundle === shown.bundle && e.file.path === shown.path);
  return (
    <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkListBox
        cssClasses={["navigation-sidebar"]}
        selectionMode={Gtk.SelectionMode.SINGLE}
        selectedIndex={selected}
        onRowActivated={(row) => {
          const entry = entries[row.getIndex()];
          if (entry?.kind === "dir") onToggleDir(`${entry.bundle}/${entry.dir.path}`, !entry.dir.open);
        }}
        onRowSelected={(row) => {
          if (row === null || row.getIndex() === selected) return;
          const entry = entries[row.getIndex()];
          if (entry?.kind === "file") onShowFile({ bundle: entry.bundle, path: entry.file.path });
        }}
      >
        {entries.map((entry) => {
          switch (entry.kind) {
            case "bundle":
              return (
                <GtkListBoxRow key={`b:${entry.bundle.bundle}`} selectable={false} activatable={false}>
                  <GtkLabel label={entry.bundle.name} xalign={0} cssClasses={["heading", "dim-label", "monospace"]} marginTop={12} marginStart={6} />
                </GtkListBoxRow>
              );
            case "dir":
              return (
                <GtkListBoxRow key={`d:${entry.bundle}/${entry.dir.path}`} selectable={false}>
                  <GtkBox spacing={6} marginStart={6 + (entry.depth - 1) * INDENT}>
                    <GtkImage iconName={entry.dir.open ? "pan-down-symbolic" : "pan-end-symbolic"} />
                    <GtkLabel label={`${entry.dir.name}/`} xalign={0} hexpand cssClasses={["monospace"]} />
                    {entry.dir.count !== undefined && !entry.dir.open ? <GtkLabel label={String(entry.dir.count)} cssClasses={["dim-label", "caption"]} /> : null}
                  </GtkBox>
                </GtkListBoxRow>
              );
            case "file":
              return (
                <GtkListBoxRow key={`f:${entry.bundle}/${entry.file.path}`}>
                  <GtkBox spacing={6} marginStart={6 + (entry.depth - 1) * INDENT + 22}>
                    <GtkLabel label={entry.file.name} xalign={0} hexpand ellipsize={Pango.EllipsizeMode.MIDDLE} maxWidthChars={1} cssClasses={["monospace"]} />
                    {entry.file.note ? <GtkLabel label={entry.file.note} cssClasses={["dim-label", "caption"]} /> : null}
                  </GtkBox>
                </GtkListBoxRow>
              );
          }
        })}
      </GtkListBox>
    </GtkScrolledWindow>
  );
}

/** A file from the Files side: its text as saving writes it, read-only, or an attachment's picture. */
export function FilePane({ file, text, attachmentName }: { file: ShownFile; text: string | undefined; attachmentName?: string }) {
  const name = file.path.split("/").pop() ?? file.path;
  return (
    <AdwToolbarView topBar={<AdwHeaderBar titleWidget={<AdwWindowTitle title={name} subtitle={`${file.bundle}.table/${file.path}`} />} />}>
      {attachmentName ? (
        <GtkBox vexpand hexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
          <AttachmentImage fileName={attachmentName} width={360} height={360} />
        </GtkBox>
      ) : text !== undefined ? (
        <GtkScrolledWindow vexpand>
          <GtkTextView editable={false} monospace wrapMode={Gtk.WrapMode.WORD_CHAR} topMargin={12} bottomMargin={12} leftMargin={16} rightMargin={16}>
            <GtkTextBuffer key={`${file.bundle}/${file.path}`} text={text} />
          </GtkTextView>
        </GtkScrolledWindow>
      ) : (
        <AdwStatusPage vexpand iconName="text-x-generic-symbolic" title="Nothing to show" description="This file has no text the table writes." />
      )}
    </AdwToolbarView>
  );
}
