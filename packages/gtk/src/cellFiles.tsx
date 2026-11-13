// A .table's cell files in an app on Node (SPEC section 6): drawn from their
// table's attachments/, chosen with the system's file chooser, replaced or
// taken out, and those a session left unnamed removed as the file closes.
// The GTK side of what table-app's TableFileView does for macOS and iOS.

import * as Adw from "@gtkx/gi/adw";
import * as Gio from "@gtkx/gi/gio";
import * as Gtk from "@gtkx/gi/gtk";
import { AdwAlertDialog } from "@gtkx/jsx/adw";
import { attachedNames, attachmentPath, bundleOf, droppedAttachments, tableNameOf, type AppState, type EmbedShown } from "@workspace.sh/table-app";
import { attachFile, packSingleFile } from "@workspace.sh/table-app/node";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A filled cell asked about: the file it names, and where. */
interface Asking {
  rowId: string;
  field: string;
  current: string;
  tableDir: string;
}

export interface CellFiles {
  /** Where an attachment's file is, for AttachmentsProvider. */
  urlOf: (fileName: string) => string | undefined;
  /** For the views: an attachment cell edited. Absent in a file to look at only. */
  onAttachFile: ((rowId: string, field: string) => void) | undefined;
  /** The question a filled cell asks, while it's asked. */
  dialog: ReactNode;
}

/**
 * Cell files for the table on screen. `setCell` sets a cell (undefined empties it), `tell` says
 * what went wrong, and `parent` is what the file chooser is shown over.
 */
export function useCellFiles({
  shown,
  state,
  lookOnly,
  setCell,
  tell,
  parent,
  chooseFile,
}: {
  shown: EmbedShown;
  state: AppState;
  lookOnly: boolean;
  setCell: ((rowId: string, field: string, value: string | undefined) => void) | undefined;
  tell: (heading: string, body: string) => void;
  parent: () => Gtk.Window | null;
  /** Ask for a file to attach: a path, or null for none. The system's file chooser when absent. */
  chooseFile?: (() => Promise<string | null>) | undefined;
}): CellFiles {
  const tableDirOf = (key: string): string | undefined => {
    const folder = shown.library.paths[bundleOf(key)];
    return folder === undefined ? undefined : join(folder, "tables", tableNameOf(key));
  };

  // The files each table named when opened, and those attached since: what's no longer named as
  // the file closes is removed then, not before, so undo brings a cell back with its file.
  const namedAtOpen = useRef<Record<string, Set<string> | null> | null>(null);
  if (!namedAtOpen.current) namedAtOpen.current = Object.fromEntries(Object.entries(state.tables).map(([key, t]) => [key, attachedNames(t)]));
  const attachedSince = useRef<Record<string, string[]>>({});
  const closing = useRef({ tables: state.tables, lookOnly });
  closing.current = { tables: state.tables, lookOnly };
  useEffect(
    () => () => {
      const { tables: now, lookOnly: looking } = closing.current;
      if (looking) return;
      for (const [key, before] of Object.entries(namedAtOpen.current ?? {})) {
        const dir = tableDirOf(key);
        const table = now[key];
        if (dir === undefined || !table) continue;
        const dropped = droppedAttachments(before, attachedSince.current[key] ?? [], attachedNames(table));
        if (dropped.length === 0) continue;
        for (const name of dropped) {
          const path = attachmentPath({ ...table, path: dir }, name);
          if (path) rmSync(path, { force: true });
        }
        void packSingleFile(dir).catch(() => {});
      }
    },
    // Once, as it goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [asking, setAsking] = useState<Asking | null>(null);

  const ask = (): Promise<string | null> => {
    if (chooseFile) return chooseFile();
    const dialog = Gtk.FileDialog.new();
    dialog.setTitle("Choose File");
    // Dismissed, or no chooser to show: none.
    return dialog.open(parent()).then((file) => file?.getPath() ?? null, () => null);
  };

  const choose = (rowId: string, field: string, tableDir: string) => {
    const key = state.active;
    void ask().then((source) => {
      if (!source || !setCell) return;
      try {
        const name = attachFile(tableDir, source);
        (attachedSince.current[key] ??= []).push(name);
        setCell(rowId, field, name);
      } catch (error) {
        tell("Couldn’t attach the file", error instanceof Error ? error.message : String(error));
      }
    });
  };

  const onAttachFile =
    lookOnly || !setCell
      ? undefined
      : (rowId: string, field: string) => {
          const tableDir = tableDirOf(state.active);
          if (tableDir === undefined) return;
          const row = state.tables[state.active]?.rows.find((r) => r.id === rowId) as Record<string, unknown> | undefined;
          const current = row?.[field];
          if (typeof current === "string" && current !== "") setAsking({ rowId, field, current, tableDir });
          else choose(rowId, field, tableDir);
        };

  const answer = (response: string) => {
    const was = asking;
    setAsking(null);
    if (!was) return;
    if (response === "open") {
      const path = attachmentPath({ ...state.tables[state.active]!, path: was.tableDir }, was.current);
      if (path) {
        new Gtk.FileLauncher({ file: Gio.File.newForPath(path) }).launch(parent()).catch(() => tell("Couldn’t open the file", `${was.current} has no app to open it.`));
      }
    } else if (response === "replace") {
      choose(was.rowId, was.field, was.tableDir);
    } else if (response === "remove") {
      // Emptied as Delete empties it: the file stays until the table closes, for undo.
      setCell?.(was.rowId, was.field, undefined);
    }
  };

  const dialog = asking ? (
    <AdwAlertDialog
      heading={asking.current}
      closeResponse="cancel"
      defaultResponse="open"
      responses={[
        { id: "cancel", label: "Cancel" },
        { id: "remove", label: "Remove", appearance: Adw.ResponseAppearance.DESTRUCTIVE },
        { id: "replace", label: "Replace…" },
        { id: "open", label: "Open", appearance: Adw.ResponseAppearance.SUGGESTED },
      ]}
      onResponse={answer}
    />
  ) : null;

  return {
    urlOf: (fileName) => {
      const dir = tableDirOf(state.active);
      const table = state.tables[state.active];
      return dir === undefined || !table ? undefined : attachmentPath({ ...table, path: dir }, fileName);
    },
    onAttachFile,
    dialog,
  };
}
