// The cases of a document of embeds in workspace-fixtures, read from disk
// as Node sees it. Its folder's parent (Fixtures/) is the folder that's
// open, so a link out of it isn't shown. Large tables are read whole here,
// so their first rows can be named.

import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { readEmbedWith } from "./embed.ts";
import { embedCasesOf, type EmbedCases } from "./embedCases.ts";
import { openSingleFile } from "./node.ts";

export async function readEmbedCases(document: string): Promise<EmbedCases> {
  const path = resolve(document);
  // Single files are unpacked into a folder of their own, never the app's.
  const home = mkdtempSync(join(tmpdir(), "embed-cases-"));
  try {
    return await embedCasesOf(readFileSync(path, "utf8"), basename(path), (address) =>
      readEmbedWith(
        nodeFs,
        { address, baseDir: dirname(path), within: dirname(dirname(path)) },
        {
          openFile: (file) => openSingleFile(file, [], { home }),
          real: (p) => {
            try {
              return realpathSync(p);
            } catch {
              return p;
            }
          },
        },
      ),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
