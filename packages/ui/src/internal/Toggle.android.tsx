/**
 * Android default. A setting is Material's switch (Compose's, from
 * @expo/ui) after its text. A table cell is Material's check box symbol,
 * which a tap flips: lighter than a Compose view in every row.
 */
import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Host, Switch } from "@expo/ui/jetpack-compose";
import type { ToggleProps } from "../controlSlots";

export function Toggle({ checked, onChange, role, label, children }: ToggleProps): ReactElement {
  if (role === "cell") {
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        // A 48 dp target around a 24 dp symbol.
        hitSlop={12}
        onPress={() => onChange(!checked)}
      >
        <SymbolView name={{ ios: "circle", android: checked ? "check_box" : "check_box_outline_blank" }} size={24} />
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, flexShrink: 1, alignSelf: "stretch", minWidth: 0 }}>
      {children ? <Text style={{ flex: 1 }}>{children}</Text> : null}
      <Host matchContents>
        <Switch value={checked} onCheckedChange={onChange} />
      </Host>
    </View>
  );
}
