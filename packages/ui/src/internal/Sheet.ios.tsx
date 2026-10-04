/**
 * iOS default. A page (a row's page) is the system's page sheet (UIKit's,
 * through React Native's Modal), its bar as a sheet's is: the leaving
 * action leading (Cancel, where there is one), the title in the
 * middle, the keeping action trailing in bold (Done). A swipe down closes
 * it when that loses nothing; otherwise the caller asks (onDismiss).
 *
 * Settings (a view's) are a form sheet that opens half way and grows
 * (react-native-screens' formSheet, with detents and a grabber), as
 * Settings-style sheets do: changes apply as they're made, Done trailing
 * keeps them and Cancel leading puts them back. React Native's Modal has
 * no detents. It has no fill of its own: part way up it's the system's
 * Liquid Glass (iOS 26), full height its opaque background.
 *
 * Either way what it holds is React Native, presented natively, not
 * hosted in SwiftUI.
 */
import type { ReactElement, ReactNode } from "react";
import { KeyboardAvoidingView, Modal, PlatformColor, Pressable, ScrollView, Text, View } from "react-native";
import { ScreenStack, ScreenStackItem } from "react-native-screens";
import type { SheetProps, SheetSlot } from "../controlSlots";

function Bar({ title, subtitle, cancel, confirm }: Pick<SheetProps, "title" | "subtitle" | "cancel" | "confirm">) {
  return (
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
      <View style={{ minWidth: 70 }}>
        {cancel && (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={cancel.onPress}>
            <Text style={{ fontSize: 17, color: PlatformColor("systemBlue") }}>{cancel.label}</Text>
          </Pressable>
        )}
      </View>
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
  );
}

function SettingsSheet({ title, cancel, confirm, onDismiss, fill, children }: SheetProps & { children: ReactNode }) {
  // A stack of its own, out of the way, to present the form sheet from:
  // its root shows nothing, and the sheet is its second screen. The sheet's
  // bar is the system's (UINavigationBar), with its own buttons: Cancel
  // leading, its title, and Done trailing.
  return (
    <ScreenStack style={{ position: "absolute", width: 0, height: 0 }}>
      <ScreenStackItem screenId="sheet-root" headerConfig={{ hidden: true }}>
        <View />
      </ScreenStackItem>
      <ScreenStackItem
        screenId="sheet"
        headerConfig={{
          title,
          hidden: false,
          // No hairline and no fill: iOS 26's sheet bar is glass over the
          // content, as the tables sheet's is. UIKit makes it so on its own only
          // for a scroll view it can find, and a SwiftUI form's it can't.
          hideShadow: true,
          translucent: true,
          backgroundColor: "transparent",
          // The system's own bar buttons, so they're Liquid Glass: Cancel a
          // cross, leading; Done a tick, trailing, in the tinted style.
          headerLeftBarButtonItems: cancel
            ? [{ type: "button", icon: { type: "sfSymbol", name: "xmark" }, accessibilityLabel: cancel.label, onPress: cancel.onPress }]
            : [],
          headerRightBarButtonItems: confirm
            ? [
                {
                  type: "button",
                  icon: { type: "sfSymbol", name: "checkmark" },
                  variant: "prominent",
                  accessibilityLabel: confirm.label,
                  disabled: confirm.disabled,
                  onPress: confirm.onPress,
                },
              ]
            : [],
        }}
        stackPresentation="formSheet"
        sheetAllowedDetents={[0.5, 1]}
        sheetGrabberVisible
        sheetExpandsWhenScrolledToEdge
        onDismissed={onDismiss}
      >
        {fill ? (
          // A platform form scrolls itself (and the sheet grows from its scroll view).
          <View style={{ flex: 1 }}>{children}</View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16 }}>{children}</ScrollView>
        )}
      </ScreenStackItem>
    </ScreenStack>
  );
}

function SheetView(props: SheetProps): ReactElement {
  const { title, subtitle, cancel, confirm, dismissible, onDismiss, children } = props;
  if (props.size === "settings") return <SettingsSheet {...props} />;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={dismissible}
      // A swipe closes it when that loses nothing. Otherwise iOS keeps the
      // sheet and reports the attempt here, for the caller to ask.
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: PlatformColor("systemBackground") }}>
        <Bar title={title} subtitle={subtitle} cancel={cancel} confirm={confirm} />
        <View style={{ flex: 1 }}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const Sheet: SheetSlot = Object.assign(SheetView, { presentsSettings: true });
