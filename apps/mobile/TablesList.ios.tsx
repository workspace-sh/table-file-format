// iOS: the tables, file by file, as the system's own list (SwiftUI's List,
// from @expo/ui), inset and grouped as Settings is: a section for each
// file, headed by its title and file name; a row for each table, with its
// row count, or a tick for the table on screen; and New Table, with the
// system's plus.

import {
  Button,
  HStack,
  Host,
  Image,
  List,
  Section,
  Spacer,
  Text,
} from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, listStyle, textCase } from "@expo/ui/swift-ui/modifiers";
import type { TablesListProps } from "./tablesList.types";

// The label colours, not hierarchical styles, which inside a button follow
// its tint and would draw every row blue.
const secondary = foregroundStyle("secondary");
const primary = foregroundStyle("primary");
// A section header as Settings sets one: small, grey, the title in capitals.
const headerText = [font({ size: 13 }), secondary, lineLimit(1)];

export function TablesList({ tree, active, onChoose, onNewTable }: TablesListProps) {
  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle("insetGrouped")]}>
        {tree.map((file) => (
          <Section
            key={file.bundle}
            header={
              <HStack spacing={6}>
                <Text modifiers={[...headerText, textCase("uppercase"), font({ size: 13, weight: "semibold" })]}>{file.title}</Text>
                <Text modifiers={headerText}>{file.file}</Text>
              </HStack>
            }
          >
            {file.tables.map((t) => {
              const on = t.key === active;
              return (
                <Button key={t.key} onPress={() => onChoose(t.key)}>
                  <HStack>
                    <Text modifiers={[primary, ...(on ? [font({ weight: "semibold" })] : [])]}>{t.title}</Text>
                    <Spacer />
                    {on ? <Image systemName="checkmark" /> : <Text modifiers={[secondary]}>{String(t.rowCount)}</Text>}
                  </HStack>
                </Button>
              );
            })}
            <Button label="New Table" systemImage="plus" onPress={() => onNewTable(file.bundle)} />
          </Section>
        ))}
      </List>
    </Host>
  );
}
