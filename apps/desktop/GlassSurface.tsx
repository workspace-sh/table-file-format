// A panel's Liquid Glass on macOS 26 (the popover material before it):
// the app's native TableGlassView (native/TablePanels), filling the panel
// behind its content. Given to table-ui through PanelSurface.
import { requireNativeComponent, StyleSheet, type ViewProps } from "react-native";

const TableGlassView = requireNativeComponent<ViewProps & { cornerRadius: number }>("TableGlassView");

export function GlassSurface({ radius }: { radius: number }) {
  return <TableGlassView pointerEvents="none" cornerRadius={radius} style={StyleSheet.absoluteFill} />;
}
