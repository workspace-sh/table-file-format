// The Mac's indexes (SPEC section 8, #435): table-app's index host for the
// Mac (macIndexHost: react-native-file-access and op-sqlite), as Workspace's
// Mac app runs it, over this app's files, in its own folder in Application
// Support. A bundle with a large table is a .table folder there, with
// `index.sqlite` beside its rows.

import { Dirs } from "react-native-file-access";
import { joinPath } from "@workspace.sh/table-core/io";
import { macIndexHost } from "@workspace.sh/table-app/mac-index-host";
import { desktopFs } from "./desktopFs";

export type { IndexDatabase, OpenedLarge } from "@workspace.sh/table-app";

/**
 * Where the Mac keeps the .table folders it holds as files: the app's own
 * folder in Application Support, apart from anything of the person's (the
 * app isn't sandboxed, so Documents would be their own Documents).
 */
export const tablesHome = (): string => joinPath(Dirs.LibraryDir ?? Dirs.DocumentDir, "Application Support", "sh.workspace.table.desktop", "tables");

export const { bundleDir, openZip, openIndexDatabase, removeFolder, removeAllFolders } = macIndexHost({ fs: desktopFs, home: tablesHome });
