/**
 * The default mark beside a row's title that says it has a page, on iOS:
 * the system's page symbol, in the secondary label colour, a little taller
 * than the title's capitals and centred on them. A cell centres its line
 * box, whose middle is above the capitals' (2.5 pt at the cells' 17 pt), so
 * the symbol is moved down by that.
 */
import { PlatformColor } from "react-native";
import { SymbolView } from "expo-symbols";
import type { PageMarkSlot } from "../controlSlots";

export const PageMark: PageMarkSlot | null = () => (
  <SymbolView
    name="doc.text"
    size={13}
    tintColor={PlatformColor("secondaryLabel")}
    style={{ width: 15, height: 15, transform: [{ translateY: 2.5 }] }}
  />
);
