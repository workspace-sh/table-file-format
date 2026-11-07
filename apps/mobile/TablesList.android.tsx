// Android: the tables, file by file, as Material's list (Compose's, from
// @expo/ui), as Android's settings and files apps list things: each file a
// heading in the primary colour with its file's name beside it, each table
// a list item with its row count, the one on screen ticked, then New Table
// and, for a file that can be closed, Close File in the error colour.

import type { ImageSourcePropType } from "react-native";
import {
  Column,
  Host,
  Icon,
  ListItem,
  Row,
  Text,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { clickable, fillMaxSize, fillMaxWidth, padding, verticalScroll } from "@expo/ui/jetpack-compose/modifiers";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useContext } from "react";
import type { TablesListProps } from "./tablesList.types";

const symbols = {
  add: require("./assets/symbols/add.xml"),
  check: require("./assets/symbols/check.xml"),
  close: require("./assets/symbols/close.xml"),
  table: require("./assets/symbols/table.xml"),
} satisfies Record<string, ImageSourcePropType>;

export function TablesList({ tree, active, onChoose, onNewTable, onClose }: TablesListProps) {
  const colors = useMaterialColors();
  const bottom = useContext(SafeAreaInsetsContext)?.bottom ?? 48;
  // Rows on the sheet's own surface; counts in the secondary colour.
  const itemColors = { containerColor: "transparent", supportingContentColor: colors.onSurfaceVariant, trailingContentColor: colors.onSurfaceVariant };
  return (
    <Host style={{ flex: 1 }}>
      <Column modifiers={[fillMaxSize(), verticalScroll(), padding(0, 8, 0, bottom + 16)]}>
        {tree.map((file) => (
          <Column key={file.bundle} modifiers={[fillMaxWidth(), padding(0, 8, 0, 8)]}>
            <Row verticalAlignment="center" modifiers={[padding(16, 8, 16, 8)]}>
              <Text color={colors.primary} style={{ typography: "titleSmall" }}>
                {file.title}
              </Text>
              <Text color={colors.onSurfaceVariant} style={{ typography: "bodySmall" }} modifiers={[padding(8, 0, 0, 0)]}>
                {file.file}
              </Text>
            </Row>
            {file.tables.map((t) => (
              <ListItem key={t.key} colors={itemColors} modifiers={[fillMaxWidth(), clickable(() => onChoose(t.key))]}>
                <ListItem.LeadingContent>
                  <Icon source={symbols.table} size={24} tint={colors.onSurfaceVariant} />
                </ListItem.LeadingContent>
                <ListItem.HeadlineContent>
                  <Text style={{ typography: "bodyLarge", fontWeight: t.key === active ? "600" : undefined }}>{t.title}</Text>
                </ListItem.HeadlineContent>
                <ListItem.TrailingContent>
                  {t.key === active ? (
                    <Icon source={symbols.check} size={24} tint={colors.primary} contentDescription="On screen" />
                  ) : (
                    <Text color={colors.onSurfaceVariant}>{String(t.rowCount)}</Text>
                  )}
                </ListItem.TrailingContent>
              </ListItem>
            ))}
            <ListItem colors={itemColors} modifiers={[fillMaxWidth(), clickable(() => onNewTable(file.bundle))]}>
              <ListItem.LeadingContent>
                <Icon source={symbols.add} size={24} tint={colors.primary} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <Text color={colors.primary}>New Table</Text>
              </ListItem.HeadlineContent>
            </ListItem>
            {file.closable ? (
              <ListItem colors={itemColors} modifiers={[fillMaxWidth(), clickable(() => onClose(file.bundle))]}>
                <ListItem.LeadingContent>
                  <Icon source={symbols.close} size={24} tint={colors.error} />
                </ListItem.LeadingContent>
                <ListItem.HeadlineContent>
                  <Text color={colors.error}>Close File</Text>
                </ListItem.HeadlineContent>
              </ListItem>
            ) : null}
          </Column>
        ))}
      </Column>
    </Host>
  );
}
