// The .table files as saving writes them, in a native sheet over the
// table on screen, as the web's sidebar shows them on its Files side.
// The browser (@workspace.sh/file-browser) knows nothing of .table files:
// table-app's tree, as plain nodes, and each file's contents come from
// here.

import { useMemo } from "react";
import { Stack } from "expo-router";
import { FileContent, FileTree, useFileBrowser, type FileContents, type FileNode } from "@workspace.sh/file-browser";
import { attachmentAt, attachmentShown, fileOfNode, fileText, filesNodes, filesTree } from "@workspace.sh/table-app";
import { fixtureAttachmentUrls, fixtureAttachments } from "@workspace.sh/table-fixtures/native-attachments";
import { useTableAppContext } from "../TableAppContext";

export default function FilesScreen() {
  const app = useTableAppContext();
  const tables = app?.state.tables;
  const bundles = app?.state.bundles;
  const active = app?.state.active;
  // Built once as the sheet opens: what's open in it is the browser's own.
  const nodes = useMemo(
    () => (tables && bundles ? filesNodes(filesTree(tables, bundles, { activeTable: active, attachmentsOf: fixtureAttachments })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  if (!app) return null;
  const load = (node: FileNode): FileContents => {
    const { bundle, path } = fileOfNode(node.id);
    const attachment = attachmentAt(bundle, path);
    if (attachment) {
      const shown = attachmentShown(attachment.name, fixtureAttachmentUrls[attachment.tableKey]?.[attachment.name]);
      return "image" in shown ? { kind: "image", uri: shown.image } : { kind: "note", text: shown.note };
    }
    const text = fileText(app.state.tables, app.state.bundles, bundle, path);
    return text === undefined ? { kind: "note", text: "This file isn't written by saving." } : { kind: "text", text };
  };
  // The sheet's own header names what's showing: Files, or the file open,
  // with a way back. So the screen holds the browser's state itself.
  return <Browser nodes={nodes} load={load} />;
}

function Browser({ nodes, load }: { nodes: FileNode[]; load: (node: FileNode) => FileContents }) {
  const state = useFileBrowser(nodes, load);
  if (state.file) {
    const { node, contents } = state.file;
    return (
      <>
        <Stack.Screen
          options={{
            title: node.name,
            unstable_headerLeftItems: () => [{ type: "button", label: "Files", icon: { type: "sfSymbol", name: "chevron.backward" }, onPress: state.close }],
          }}
        />
        <FileContent node={node} contents={contents} onBack={state.close} bar={false} />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: "Files", unstable_headerLeftItems: () => [] }} />
      <FileTree state={state} />
    </>
  );
}
