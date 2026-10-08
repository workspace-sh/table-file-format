// Every platform without a list of its own yet (Android, macOS, web): the
// tree in React Native's own views, folders opening in place, a file
// opening over the tree. iOS draws the system's list (FileBrowser.ios.tsx).

import { FlatList, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { FileContent } from "./FileContent";
import { useFileBrowser } from "./useFileBrowser.ts";
import type { FileBrowserProps, FileBrowserState } from "./types.ts";

export function FileBrowser({ nodes, load, renderBrowser, renderFile }: FileBrowserProps) {
  const state = useFileBrowser(nodes, load);
  if (state.file) return <>{renderFile ? renderFile(state.file, state.close) : <FileContent node={state.file.node} contents={state.file.contents} onBack={state.close} />}</>;
  if (renderBrowser) return <>{renderBrowser(state)}</>;
  return <FileTree state={state} />;
}

/** The tree alone, from the browser's state: for an app that puts the open file elsewhere. */
export function FileTree({ state }: { state: FileBrowserState }) {
  const dark = useColorScheme() === "dark";
  const text = dark ? "#f5f5f7" : "#1c1c1e";
  const dim = dark ? "#8a8a93" : "#6e6e73";
  return (
    <FlatList
      data={state.rows}
      keyExtractor={(r) => r.node.id}
      renderItem={({ item: { node, depth, folder, expanded } }) => (
        <Pressable
          onPress={() => (folder ? state.toggle(node.id) : state.open(node.id))}
          accessibilityRole="button"
          accessibilityState={folder ? { expanded } : undefined}
          style={({ pressed }) => [styles.row, { paddingLeft: 16 + depth * 16 }, pressed && styles.pressed]}
        >
          <Text style={[styles.chevron, { color: dim }]}>{folder ? (expanded ? "▾" : "▸") : " "}</Text>
          <Text style={[depth === 0 ? styles.top : folder ? styles.folder : styles.file, { color: text }]} numberOfLines={1}>
            {node.name}
          </Text>
          {node.note ? <Text style={[styles.note, { color: dim }]}>{node.note}</Text> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 16, paddingVertical: 10 },
  pressed: { opacity: 0.5 },
  chevron: { width: 12, fontSize: 12 },
  top: { flex: 1, fontSize: 15, fontWeight: "600" },
  folder: { flex: 1, fontSize: 15 },
  file: { flex: 1, fontSize: 14, fontFamily: "Menlo" },
  note: { fontSize: 13 },
});
