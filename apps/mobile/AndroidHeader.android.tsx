// The table screen's actions on Android, Material's way: the tables list
// as the top app bar's navigation icon, then the views, View settings and
// an overflow menu for the file actions, as Compose icon buttons and
// dropdown menus. iOS has the same actions in its glass toolbars (the
// expo-router toolbars there are iOS only); search is the stack's search
// bar on both.
//
// The icons are Material Symbols (Apache 2.0) as Android vector drawables,
// in assets/symbols: each glyph's path from the Material Symbols font that
// expo-symbols already ships (@expo-google-fonts/material-symbols, weight
// 400), in its 960-unit box.

import { useState, type ReactNode } from "react";
import type { ImageSourcePropType } from "react-native";
import type { AndroidHeaderActionsProps, MaterialSymbol } from "./AndroidHeader.types";
import { useTheme } from "@react-navigation/native";
import {
  DropdownMenu,
  DropdownMenuItem,
  FilledTonalIconButton,
  Host,
  Icon,
  IconButton,
  Row,
  Text,
} from "@expo/ui/jetpack-compose";

const symbols = {
  menu: require("./assets/symbols/menu.xml"),
  stacks: require("./assets/symbols/stacks.xml"),
  tune: require("./assets/symbols/tune.xml"),
  more_vert: require("./assets/symbols/more_vert.xml"),
  check: require("./assets/symbols/check.xml"),
  add: require("./assets/symbols/add.xml"),
  table: require("./assets/symbols/table.xml"),
  note_add: require("./assets/symbols/note_add.xml"),
  folder_open: require("./assets/symbols/folder_open.xml"),
  share: require("./assets/symbols/share.xml"),
} satisfies Record<MaterialSymbol, ImageSourcePropType>;

/** The navigation icon: the tables list. */
export function AndroidTablesButton({ onPress }: { onPress: () => void }) {
  return (
    <Host matchContents>
      <IconButton onClick={onPress}>
        <HeaderIcon symbol="menu" label="Tables" />
      </IconButton>
    </Host>
  );
}

/** The actions at the end of the top app bar. */
export function AndroidHeaderActions({ views, settingsOpen, onSettings, more }: AndroidHeaderActionsProps) {
  // A toggle icon button, as Material shows one that's on.
  const Settings = settingsOpen ? FilledTonalIconButton : IconButton;
  return (
    <Host matchContents>
      <Row>
        <Menu symbol="stacks" label="Views" items={views} />
        <Settings onClick={onSettings}>
          <HeaderIcon symbol="tune" label="View Settings" />
        </Settings>
        <Menu symbol="more_vert" label="More" items={more} />
      </Row>
    </Host>
  );
}

function HeaderIcon({ symbol, label }: { symbol: MaterialSymbol; label: string }) {
  // Tinted as the header's title: the drawables' own fill is black.
  const { colors } = useTheme();
  return <Icon source={symbols[symbol]} size={24} tint={colors.text} contentDescription={label} />;
}

function Menu({ symbol, label, items }: { symbol: MaterialSymbol; label: string; items: AndroidHeaderActionsProps["views"] }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const icon = (name: MaterialSymbol): ReactNode => <Icon source={symbols[name]} size={24} tint={colors.text} />;
  return (
    <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
      <DropdownMenu.Trigger>
        <IconButton onClick={() => setOpen(true)}>
          <HeaderIcon symbol={symbol} label={label} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Items>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onClick={() => {
              setOpen(false);
              item.onPress();
            }}
          >
            {item.icon && <DropdownMenuItem.LeadingIcon>{icon(item.icon)}</DropdownMenuItem.LeadingIcon>}
            <DropdownMenuItem.Text>
              <Text>{item.label}</Text>
            </DropdownMenuItem.Text>
            {item.checked && <DropdownMenuItem.TrailingIcon>{icon("check")}</DropdownMenuItem.TrailingIcon>}
          </DropdownMenuItem>
        ))}
      </DropdownMenu.Items>
    </DropdownMenu>
  );
}
