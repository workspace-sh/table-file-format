/**
 * iOS default. A setting is the system's switch (SwiftUI's Toggle, from
 * @expo/ui), its text before it, as in Settings. A table cell is a
 * symbol a tap flips, as Reminders' check circles are: a switch in every
 * row would be clutter, and the HIG keeps switches to list rows.
 */
import type { ReactElement } from "react";
import { PlatformColor, Pressable } from "react-native";
import { SymbolView } from "expo-symbols";
import { Host, Toggle as SwiftToggle } from "@expo/ui/swift-ui";
import { fixedSize, font, lineLimit } from "@expo/ui/swift-ui/modifiers";
import type { ToggleProps } from "../controlSlots";

export function Toggle({ checked, onChange, role, label, children }: ToggleProps): ReactElement {
  if (role === "cell") {
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        // A 44 pt target around a 22 pt symbol.
        hitSlop={11}
        onPress={() => onChange(!checked)}
      >
        <SymbolView
          name={checked ? "checkmark.circle.fill" : "circle"}
          size={22}
          tintColor={checked ? PlatformColor("systemBlue") : PlatformColor("tertiaryLabel")}
        />
      </Pressable>
    );
  }
  return (
    // The row's whole width, in a row or a column: the text on the left, the switch on the right.
    <Host matchContents={{ vertical: true }} style={{ flexGrow: 1, flexShrink: 1, alignSelf: "stretch", minWidth: 0 }}>
      {/* Its text wraps as long as it needs, growing the row, rather than cut to one line. */}
      <SwiftToggle
        label={children ?? label ?? ""}
        isOn={checked}
        onIsOnChange={onChange}
        // The settings' own text size, not SwiftUI's 17 pt body, so the
        // description reads as part of the row rather than over it.
        modifiers={[font({ size: 13 }), lineLimit(), fixedSize({ horizontal: false, vertical: true })]}
      />
    </Host>
  );
}
