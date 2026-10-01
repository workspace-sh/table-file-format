/**
 * iOS default: the system's page sheet (UIKit's, through React Native's
 * Modal), sliding up over the screen, its bar as a sheet's is: the
 * leaving action leading (Close, or Discard with changes), the title in
 * the middle, the keeping action trailing in bold (Save). A swipe down
 * closes it when that loses nothing; with changes it asks first.
 * What it holds is React Native, presented natively, not hosted in SwiftUI.
 */
import type { ReactElement } from "react";
import { Alert, KeyboardAvoidingView, Modal, PlatformColor, Pressable, Text, View } from "react-native";
import type { SheetProps } from "../controlSlots";

export function Sheet({ title, subtitle, cancel, confirm, dismissible, onDismiss, children }: SheetProps): ReactElement {
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={dismissible}
      // A swipe closes it when that loses nothing. With changes, iOS keeps
      // the sheet and reports the attempt here: ask, as Notes and Mail do.
      onRequestClose={() => {
        if (dismissible) onDismiss();
        else
          Alert.alert("", undefined, [
            { text: "Discard Changes", style: "destructive", onPress: cancel.onPress },
            { text: "Keep Editing", style: "cancel" },
          ]);
      }}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: PlatformColor("systemBackground") }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: 10,
            gap: 12,
            borderBottomWidth: 0.5,
            borderBottomColor: PlatformColor("separator"),
          }}
        >
          <Pressable accessibilityRole="button" hitSlop={10} onPress={cancel.onPress} style={{ minWidth: 70 }}>
            <Text style={{ fontSize: 17, color: PlatformColor("systemBlue") }}>{cancel.label}</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text numberOfLines={1} accessibilityRole="header" style={{ fontSize: 17, fontWeight: "600", color: PlatformColor("label") }}>
              {title}
            </Text>
            {subtitle !== undefined && (
              <Text numberOfLines={1} style={{ fontSize: 12, color: PlatformColor("secondaryLabel") }}>
                {subtitle}
              </Text>
            )}
          </View>
          <View style={{ minWidth: 70, alignItems: "flex-end" }}>
            {confirm && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !!confirm.disabled }}
                disabled={confirm.disabled}
                hitSlop={10}
                onPress={confirm.onPress}
              >
                <Text
                  style={{
                    fontSize: 17,
                    fontWeight: "600",
                    color: confirm.disabled ? PlatformColor("tertiaryLabel") : PlatformColor("systemBlue"),
                  }}
                >
                  {confirm.label}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
