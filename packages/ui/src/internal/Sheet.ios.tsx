/**
 * iOS default. Both kinds are the system's own sheets (react-native-screens),
 * with the system's bar and its own Liquid Glass buttons: Cancel a cross,
 * leading, where there is one; the title in the middle; Done a tinted
 * tick, trailing.
 *
 * A page (a row's page) is a page sheet. A swipe down closes it when that
 * loses nothing; otherwise iOS keeps it and the caller asks (onDismiss).
 *
 * Settings are a form sheet that opens half way and grows, with a grabber,
 * as Settings-style sheets do: changes apply as they're made, Done keeps
 * them and Cancel puts them back. It has no fill of its own: part way up
 * it's the system's Liquid Glass (iOS 26), full height its opaque
 * background.
 *
 * What it holds is React Native, or a platform form (SettingsForm) that
 * fills it.
 */
import type { ReactElement } from "react";
import { KeyboardAvoidingView, PlatformColor, ScrollView, Text, View } from "react-native";
import { ScreenStack, ScreenStackHeaderCenterView, ScreenStackItem } from "react-native-screens";
import type { SheetProps, SheetSlot } from "../controlSlots";

function NativeSheet({ size, title, subtitle, cancel, confirm, dismissible, onDismiss, fill, children }: SheetProps) {
  const page = size !== "settings";
  // A stack of its own, out of the way, to present the sheet from: its root
  // shows nothing, and the sheet is its second screen. The sheet's bar is
  // the system's (UINavigationBar), with the system's own buttons, so they
  // are Liquid Glass: Cancel a cross, leading; Done a tick, trailing, in
  // the tinted style.
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
          hideShadow: true,
          // Settings: no fill, so the bar is glass over the form, as the tables
          // sheet's is. UIKit makes it so on its own only for a scroll view it
          // can find, and a SwiftUI form's it can't; the form insets itself.
          // A page's editor doesn't, so its bar is the standard one, with the
          // page below it.
          ...(page ? {} : { translucent: true, backgroundColor: "transparent" }),
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
          // A page's file under its title: the bar has no subtitle of its own.
          children:
            subtitle !== undefined
              ? [
                  <ScreenStackHeaderCenterView key="title">
                    <View style={{ alignItems: "center" }}>
                      <Text numberOfLines={1} accessibilityRole="header" style={{ fontSize: 17, fontWeight: "600", color: PlatformColor("label") }}>
                        {title}
                      </Text>
                      <Text numberOfLines={1} style={{ fontSize: 12, color: PlatformColor("secondaryLabel") }}>
                        {subtitle}
                      </Text>
                    </View>
                  </ScreenStackHeaderCenterView>,
                ]
              : [],
        }}
        {...(page
          ? {
              stackPresentation: "pageSheet" as const,
              // A swipe closes it when that loses nothing. Otherwise iOS keeps
              // the sheet and reports the attempt, for the caller to ask.
              preventNativeDismiss: !dismissible,
              onNativeDismissCancelled: onDismiss,
            }
          : {
              stackPresentation: "formSheet" as const,
              sheetAllowedDetents: [0.5, 1],
              sheetGrabberVisible: true,
              sheetExpandsWhenScrolledToEdge: true,
            })}
        onDismissed={onDismiss}
      >
        {page ? (
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: PlatformColor("systemBackground") }}>
            {children}
          </KeyboardAvoidingView>
        ) : fill ? (
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
  return <NativeSheet {...props} />;
}

export const Sheet: SheetSlot = Object.assign(SheetView, { presentsSettings: true });
