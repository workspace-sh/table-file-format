// The browser's state, without any view: an app can draw the tree its own
// way with this alone, and the default views are drawn from it too.

import { useEffect, useMemo, useState } from "react";
import { findNode, initiallyOpen, visibleRows } from "./tree.ts";
import type { FileBrowserState, FileContents, FileNode } from "./types.ts";

export function useFileBrowser(
  nodes: FileNode[],
  load: (node: FileNode) => FileContents | Promise<FileContents>,
): FileBrowserState {
  const [expanded, setExpanded] = useState(() => initiallyOpen(nodes));
  const [openId, setOpenId] = useState<string | null>(null);
  const [contents, setContents] = useState<FileContents | null>(null);
  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
  const node = openId ? (findNode(nodes, openId) ?? null) : null;

  // A file's contents as it opens; a slow load that's overtaken is dropped.
  useEffect(() => {
    if (!node) return;
    let current = true;
    setContents(null);
    void Promise.resolve(load(node)).then(
      (c) => current && setContents(c),
      (e: unknown) => current && setContents({ kind: "note", text: e instanceof Error ? e.message : "Couldn't open this file." }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return {
    rows,
    toggle: (id) =>
      setExpanded((was) => {
        const next = new Set(was);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    open: (id) => {
      const n = findNode(nodes, id);
      if (n && !n.children && n.opens !== "none") setOpenId(id);
    },
    close: () => setOpenId(null),
    file: node ? { node, contents } : null,
  };
}
