/**
 * macOS: the views' lines are the system's separator colour (AppKit's
 * `separatorColor`, through PlatformColor), so they show on the window's own
 * background, light or dark, and follow Increase Contrast. Written for the
 * web, the dark line (#26262b) was all but the colour of a dark Mac window,
 * and the table's lines disappeared at night.
 *
 * Only the lines, for now: the rest of the palette stays as written (see
 * systemColors.ios.ts for the whole swap on iOS).
 */
import { PlatformColor } from "react-native";
import { swapSystemColors } from "../systemColorRoles";

/** The AppKit colour for each role taken on the Mac; the others stay as written. */
const MAC_ROLES: Readonly<Record<string, string>> = {
  separator: "separatorColor",
};

/** Swap, in place, the lines of a css.create result for the system's. */
export function adoptSystemColors(styles: object): void {
  swapSystemColors(styles, (role) => {
    const mac = MAC_ROLES[role];
    return mac ? PlatformColor(mac) : undefined;
  });
}

/** The platform colour (by the name PlatformColor takes) that plays `role` on the Mac, where it's taken. */
export function systemColorName(role: string): string | undefined {
  return MAC_ROLES[role];
}
