// iOS: the tree as the system's own list (SwiftUI's List, from @expo/ui),
// grouped as Settings is, a section for each of the tree's own entries.
// Folder rows are composed by hand rather than with DisclosureGroup, whose
// whole label is the disclosure control (Workspace's macOS sidebar found
// the same): the chevron shows the state, and the whole row toggles.

import { Button, HStack, Host, Image, List, Section, Spacer, Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, lineLimit, listStyle, padding, textCase } from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { PlatformColor } from "react-native";
import { FileContent } from "./FileContent";
import { symbolFor } from "./tree.ts";
import { useFileBrowser } from "./useFileBrowser.ts";
import type { FileBrowserProps, FileBrowserState, FileRow } from "./types.ts";

type Symbol = NonNullable<ComponentProps<typeof Image>["systemName"]>;
// The label colours: inside a button, hierarchical styles follow its tint.
const secondary = foregroundStyle("secondary");
const primary = foregroundStyle("primary");

export function FileBrowser({ nodes, load, renderBrowser, renderFile }: FileBrowserProps) {
  const state = useFileBrowser(nodes, load);
  if (state.file) return <>{renderFile ? renderFile(state.file, state.close) : <FileContent node={state.file.node} contents={state.file.contents} onBack={state.close} />}</>;
  if (renderBrowser) return <>{renderBrowser(state)}</>;
  return <FileTree state={state} />;
}

/** The tree alone, from the browser's state: for an app that puts the open file elsewhere. */
export function FileTree({ state }: { state: FileBrowserState }) {
  // A section per top-level entry; its rows are what shows under it.
  const sections: { head: FileRow; rows: FileRow[] }[] = [];
  for (const row of state.rows) {
    if (row.depth === 0) sections.push({ head: row, rows: [] });
    else sections.at(-1)?.rows.push(row);
  }
  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle("insetGrouped")]}>
        {sections.map(({ head, rows }) => (
          <Section
            key={head.node.id}
            header={
              <HStack spacing={6}>
                <Text modifiers={[font({ size: 13, weight: "semibold" }), secondary, textCase("uppercase"), lineLimit(1)]}>{head.node.name}</Text>
                {head.node.note ? <Text modifiers={[font({ size: 13 }), secondary, lineLimit(1)]}>{head.node.note}</Text> : null}
              </HStack>
            }
          >
            {rows.map((row) => (
              <Row key={row.node.id} row={row} state={state} />
            ))}
          </Section>
        ))}
      </List>
    </Host>
  );
}

function Row({ row, state }: { row: FileRow; state: FileBrowserState }) {
  const { node, depth, folder, expanded } = row;
  const opens = !folder && node.opens !== "none";
  return (
    <Button onPress={() => (folder ? state.toggle(node.id) : state.open(node.id))}>
      <HStack spacing={8} modifiers={[padding({ leading: (depth - 1) * 18 })]}>
        {/* The chevron shows the state; the whole row is the target. Images
            take their colour from `color`: inside a button, its tint wins over a style. */}
        {folder ? (
          <Image systemName={expanded ? "chevron.down" : "chevron.right"} size={11} color={PlatformColor("secondaryLabel")} modifiers={[frame({ width: 12 })]} />
        ) : (
          <Text modifiers={[frame({ width: 12 })]}> </Text>
        )}
        <Image
          systemName={symbolFor(node, expanded) as Symbol}
          size={15}
          color={folder ? PlatformColor("systemBlue") : PlatformColor("secondaryLabel")}
          modifiers={[frame({ width: 22 })]}
        />
        <Text modifiers={[primary, font({ size: 16, design: folder ? "default" : "monospaced" }), lineLimit(1)]}>{node.name}</Text>
        <Spacer />
        {node.note ? <Text modifiers={[secondary, font({ size: 14 }), lineLimit(1)]}>{node.note}</Text> : null}
        {opens ? <Image systemName="chevron.forward" size={12} color={PlatformColor("tertiaryLabel")} /> : null}
      </HStack>
    </Button>
  );
}
