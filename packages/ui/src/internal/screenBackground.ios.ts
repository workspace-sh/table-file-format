/** The colour the views are drawn to sit on, on iOS: the system background, white in Light and black in Dark, as their bands are. */
import { PlatformColor, type ColorValue } from "react-native";

export const screenBackground: ColorValue | undefined = PlatformColor("systemBackground");
