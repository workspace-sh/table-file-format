/**
 * Android default: Material's full-screen dialog (React Native's Modal),
 * as Android edits something apart from the screen: close leading, the
 * title, the keeping action trailing (Save). Back closes it when that
 * loses nothing; with changes it asks first.
 */
import type { ReactElement } from "react";
import { Alert, Modal, Pressable, Text, View, useColorScheme } from "react-native";
import { SymbolView } from "expo-symbols";
import type { SheetProps } from "../controlSlots";

export function Sheet({ title, subtitle, cancel, confirm, dismissible, onDismiss, children }: SheetProps): ReactElement {
  const dark = useColorScheme() === "dark";
  const surface = dark ? "#141218" : "#FEF7FF";
  const onSurface = dark ? "#E6E0E9" : "#1D1B20";
  const primary = dark ? "#D0BCFF" : "#6750A4";
  return (
    <Modal
      visible
      animationType="slide"
      // Back closes it when that loses nothing; with changes it asks first.
      onRequestClose={() => {
        if (dismissible) onDismiss();
        else
          Alert.alert("Discard changes?", undefined, [
            { text: "Keep editing", style: "cancel" },
            { text: "Discard", style: "destructive", onPress: cancel.onPress },
          ]);
      }}
    >
      <View style={{ flex: 1, backgroundColor: surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 64, paddingHorizontal: 4, gap: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={cancel.label} onPress={cancel.onPress} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={24} tintColor={onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} accessibilityRole="header" style={{ fontSize: 22, color: onSurface }}>
              {title}
            </Text>
            {subtitle !== undefined && (
              <Text numberOfLines={1} style={{ fontSize: 12, color: onSurface, opacity: 0.7 }}>
                {subtitle}
              </Text>
            )}
          </View>
          {confirm && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !!confirm.disabled }}
              disabled={confirm.disabled}
              onPress={confirm.onPress}
              style={{ paddingHorizontal: 12, height: 48, justifyContent: "center" }}
            >
              <Text style={{ fontSize: 14, fontWeight: "500", color: primary, opacity: confirm.disabled ? 0.38 : 1 }}>{confirm.label}</Text>
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </Modal>
  );
}
