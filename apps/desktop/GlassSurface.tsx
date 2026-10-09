// A panel's Liquid Glass on macOS 26 (the popover material before it):
// the app's native TableGlassView (native/TablePanels), holding the panel's
// content inside the glass. Given to table-ui through PanelSurface.
import type { ReactNode } from "react";
import { requireNativeComponent, StyleSheet, type ViewProps } from "react-native";

const TableGlassView = requireNativeComponent<ViewProps & { cornerRadius: number }>("TableGlassView");

export function GlassSurface({ radius, children }: { radius: number; children: ReactNode }) {
  return (
    <TableGlassView cornerRadius={radius} style={styles.fill}>
      {children}
    </TableGlassView>
  );
}

// The panel's own column, so its header, body and foot lay out as they did.
const styles = StyleSheet.create({
  fill: { flexGrow: 1, flexShrink: 1, flexDirection: "column", minHeight: 0 },
});
