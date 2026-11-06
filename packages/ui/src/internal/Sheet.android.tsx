/**
 * Android default, in Material's two ways of editing apart from the screen.
 *
 * A page (a row's page) is Material's full-screen dialog (React Native's
 * Modal): close leading, the title, the keeping action trailing. Back
 * closes it when that loses nothing; with changes it asks first.
 *
 * Settings are Material's modal bottom sheet (Compose's, from @expo/ui),
 * which opens half way and is dragged up to grow, as iOS's form sheet
 * does: changes apply as they're made, Done keeps them, the close button
 * (Cancel) puts them back, and a drag down, Back or a tap outside closes
 * it keeping them. A platform form (SettingsForm, `fill`) is part of the
 * sheet's own Compose tree, so the sheet's drag and the form's scroll are
 * one gesture; anything else is React Native, hosted in it.
 *
 * Colours are the system's (Material You's dynamic colour, where the
 * phone has it).
 */
import type { ReactElement } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View, type ImageSourcePropType } from "react-native";
import { SymbolView } from "expo-symbols";
import {
  Column,
  Host,
  Icon,
  IconButton,
  ModalBottomSheet,
  RNHostView,
  Row,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height, padding, weight } from "@expo/ui/jetpack-compose/modifiers";
import type { SheetProps, SheetSlot } from "../controlSlots";
import { InSettingsSheet } from "./settingsSheet";

const symbols = {
  close: require("./material/close.xml"),
} satisfies Record<string, ImageSourcePropType>;

function SettingsSheet({ title, cancel, confirm, onDismiss, fill, children }: SheetProps) {
  const colors = useMaterialColors();
  return (
    <Host matchContents>
      <ModalBottomSheet onDismissRequest={onDismiss} containerColor={colors.surfaceContainerLow}>
        <Column modifiers={[fillMaxWidth()]}>
          <Row verticalAlignment="center" modifiers={[fillMaxWidth(), height(56), padding(4, 0, 8, 0)]}>
            {cancel ? (
              <IconButton onClick={cancel.onPress}>
                <Icon source={symbols.close} size={24} tint={colors.onSurfaceVariant} contentDescription={cancel.label} />
              </IconButton>
            ) : null}
            <ComposeText
              maxLines={1}
              style={{ typography: "titleLarge" }}
              color={colors.onSurface}
              modifiers={[weight(1), padding(cancel ? 4 : 12, 0, 8, 0)]}
            >
              {title}
            </ComposeText>
            {confirm ? (
              <TextButton onClick={confirm.onPress} enabled={!confirm.disabled}>
                <ComposeText>{confirm.label}</ComposeText>
              </TextButton>
            ) : null}
          </Row>
          {fill ? (
            <InSettingsSheet.Provider value>{children}</InSettingsSheet.Provider>
          ) : (
            <RNHostView matchContents={{ vertical: true }}>
              <ScrollView contentContainerStyle={{ padding: 16 }}>{children}</ScrollView>
            </RNHostView>
          )}
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}

function PageDialog({ title, subtitle, cancel, confirm, dismissible, onDismiss, children }: SheetProps) {
  const colors = useMaterialColors();
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
            { text: "Discard", style: "destructive", onPress: cancel?.onPress ?? onDismiss },
          ]);
      }}
    >
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 64, paddingHorizontal: 4, gap: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={cancel?.label ?? "Close"} onPress={cancel?.onPress ?? onDismiss} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={24} tintColor={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} accessibilityRole="header" style={{ fontSize: 22, color: colors.onSurface }}>
              {title}
            </Text>
            {subtitle !== undefined && (
              <Text numberOfLines={1} style={{ fontSize: 12, color: colors.onSurfaceVariant }}>
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
              <Text style={{ fontSize: 14, fontWeight: "500", color: colors.primary, opacity: confirm.disabled ? 0.38 : 1 }}>{confirm.label}</Text>
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </Modal>
  );
}

function SheetView(props: SheetProps): ReactElement {
  return props.size === "settings" ? <SettingsSheet {...props} /> : <PageDialog {...props} />;
}

export const Sheet: SheetSlot = Object.assign(SheetView, { presentsSettings: true });
