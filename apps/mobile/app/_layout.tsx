// How a host app frames the table views on a phone, the platform's way: a
// native navigation stack (large titles, toolbars and search in Liquid
// Glass on iOS 26+), with the tables list as a native sheet. The views
// themselves are table-ui's; table-ui owns no navigation.

import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useColorScheme } from "react-native";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import * as ExpoHaptics from "expo-haptics";
import { AttachmentsProvider, DisplaySettingsProvider, HapticsProvider, type Haptics } from "@workspace.sh/table-ui";
import { fixtureAttachmentUrls } from "@workspace.sh/table-fixtures/native-attachments";
import { TableAppProvider, useTableAppContext } from "../TableAppContext";

export default function Layout() {
  // The navigation follows the system's appearance, as the views do: a
  // light stack under dark content would hide it, and iOS 26's glass
  // buttons flicker when the two disagree.
  const scheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
      <TableAppProvider>
        <Providers>
          <Stack>
            <Stack.Screen name="index" options={{ headerLargeTitleEnabled: true }} />
            <Stack.Screen
              name="files"
              options={{
                title: "Files",
                presentation: "formSheet",
                sheetAllowedDetents: [0.6, 1],
                sheetGrabberVisible: true,
                headerLargeTitleEnabled: false,
              }}
            />
            <Stack.Screen
              name="tables"
              options={{
                title: "Tables",
                presentation: "formSheet",
                sheetAllowedDetents: [0.6, 1],
                sheetGrabberVisible: true,
                headerLargeTitleEnabled: false,
              }}
            />
          </Stack>
        </Providers>
      </TableAppProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

// The views' ticks (a resized row passing a line) as the system's
// selection feedback, the light click a picker wheel gives.
const haptics: Haptics = { step: () => void ExpoHaptics.selectionAsync() };

/**
 * What every screen draws in: the viewer's display settings, haptics, and
 * attachments from the fixtures. Each screen has its own PortalHost, since
 * a native screen covers anything drawn outside it.
 */
function Providers({ children }: { children: React.ReactNode }) {
  const app = useTableAppContext();
  if (!app) return <>{children}</>;
  return (
    <DisplaySettingsProvider value={app.display}>
      <HapticsProvider value={haptics}>
        <AttachmentsProvider value={(file) => fixtureAttachmentUrls[app.state.active]?.[file]}>{children}</AttachmentsProvider>
      </HapticsProvider>
    </DisplaySettingsProvider>
  );
}
