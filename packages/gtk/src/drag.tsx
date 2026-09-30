// Dragging rows on GTK: a card or list row carries its row's id as text,
// and what a drop does to the order comes from table-ui/shared's cards
// module (orderAfterDrop, orderMovedTo), as on the web.

import * as Gdk from "@gtkx/gi/gdk";
import * as GObject from "@gtkx/gi/gobject";
import type * as Gtk from "@gtkx/gi/gtk";
import { GtkDragSource, GtkDropTarget } from "@gtkx/jsx/gtk";

/** The type a dragged row travels as: its id, as a string. */
const ROW_ID = GObject.typeFromName("gchararray");

/** A drag source carrying `rowId`. */
export function dragRow(rowId: string) {
  return <GtkDragSource actions={Gdk.DragAction.MOVE} onPrepare={() => Gdk.ContentProvider.newForValue(rowId)} />;
}

/**
 * A drop target for a dragged row: `onRow` gets its id, and whether it
 * landed in the lower half of the target (so after it, not before).
 */
export function dropRow(onRow: (rowId: string, lowerHalf: boolean) => void) {
  return (
    <GtkDropTarget
      types={[ROW_ID]}
      actions={Gdk.DragAction.MOVE}
      onDrop={(value: GObject.Value, _x: number, y: number, self: Gtk.DropTarget) => {
        const id = value.getString();
        if (!id) return false;
        const height = self.getWidget()?.getHeight() ?? 0;
        onRow(id, height > 0 && y > height / 2);
        return true;
      }}
    />
  );
}
