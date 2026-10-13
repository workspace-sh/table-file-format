// The view for a layout: what an app draws for a view once it knows which
// one, as the web demo's `renderView` picks the table-ui one.

import type { View } from "@workspace.sh/table-core";
import type { ViewProps } from "@workspace.sh/table-ui/shared";

import { BoardView, CalendarView, GalleryView, ListView } from "./cards.js";
import { TableView } from "./TableView.js";

export function LayoutView({ layout, ...props }: ViewProps & { layout: View["layout"] }) {
  switch (layout) {
    case "board":
      return <BoardView {...props} />;
    case "gallery":
      return <GalleryView {...props} />;
    case "list":
      return <ListView {...props} />;
    case "calendar":
      return <CalendarView {...props} />;
    default:
      return <TableView {...props} />;
  }
}
