// An open file, on any platform: its text, monospaced and scrolling both
// ways (long lines run on, as a code editor shows them), or its image, or
// why there's nothing to show. React Native's own views, so it draws
// everywhere the browser does.

import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import type { FileContents, FileNode } from "./types.ts";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

/**
 * `bar` false: no back button and name of its own, for a screen whose
 * navigation bar shows them (a native sheet's header).
 */
export function FileContent({ node, contents, onBack, bar = true }: { node: FileNode; contents: FileContents | null; onBack: () => void; bar?: boolean }) {
  const dark = useColorScheme() === "dark";
  const text = dark ? "#f5f5f7" : "#1c1c1e";
  const dim = dark ? "#8a8a93" : "#6e6e73";
  return (
    <View style={styles.root}>
      {bar ? (
        <View style={styles.bar}>
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to the files" hitSlop={10}>
            <Text style={styles.back}>‹ Files</Text>
          </Pressable>
          <Text style={[styles.name, { color: text }]} numberOfLines={1}>
            {node.name}
          </Text>
        </View>
      ) : null}
      {contents === null ? (
        <Text style={[styles.note, { color: dim }]}>Opening…</Text>
      ) : contents.kind === "note" ? (
        <Text style={[styles.note, { color: dim }]}>{contents.text}</Text>
      ) : contents.kind === "image" ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.fill} contentInsetAdjustmentBehavior="automatic">
          <Image source={{ uri: contents.uri }} style={styles.image} resizeMode="contain" accessibilityLabel={node.name} />
        </ScrollView>
      ) : (
        // Inset under a navigation bar the screen has, as the system's lists are.
        <ScrollView style={styles.fill} contentContainerStyle={styles.pad} contentInsetAdjustmentBehavior="automatic">
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Text selectable style={[styles.text, { color: text }]}>
              {contents.text}
            </Text>
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  back: { fontSize: 17, color: "#0a84ff" },
  name: { flex: 1, fontSize: 15, fontWeight: "600", fontFamily: MONO },
  note: { fontSize: 15, paddingHorizontal: 16, paddingVertical: 8 },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  text: { fontSize: 12, lineHeight: 18, fontFamily: MONO },
  image: { flex: 1, margin: 16 },
});
