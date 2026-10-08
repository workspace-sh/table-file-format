// The tree as plain data: which folders start open, and what shows. Kept
// apart from React so any interface (and the tests) can use it.

import type { FileNode, FileRow } from "./types.ts";

/** The folders that start open: those marked `open`. */
export function initiallyOpen(nodes: FileNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.children) {
        if (n.open) out.add(n.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/** The rows that show, top to bottom: a closed folder's entries don't. */
export function visibleRows(nodes: FileNode[], expanded: ReadonlySet<string>): FileRow[] {
  const out: FileRow[] = [];
  const walk = (list: FileNode[], depth: number) => {
    for (const node of list) {
      const folder = node.children !== undefined;
      const isOpen = folder && expanded.has(node.id);
      out.push({ node, depth, folder, expanded: isOpen });
      if (isOpen) walk(node.children!, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** A node by its id, anywhere in the tree. */
export function findNode(nodes: FileNode[], id: string): FileNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inside = n.children && findNode(n.children, id);
    if (inside) return inside;
  }
  return undefined;
}

/** A system symbol for a file, by what its name says it holds. */
export function symbolFor(node: FileNode, expanded = false): string {
  if (node.children) return expanded ? "folder.fill" : "folder";
  const name = node.name.toLowerCase();
  if (/\.(md|markdown|mdown|mkd)$/.test(name)) return "doc.richtext";
  if (/\.(json|ndjson|jsonl)$/.test(name)) return "curlybraces";
  if (/\.(png|jpe?g|gif|webp|svg|heic|tiff?)$/.test(name)) return "photo";
  if (/\.txt$/.test(name)) return "doc.text";
  return "doc";
}
