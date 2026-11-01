// A table's view in whichever layout it has, over table-ui's views: what an
// embed and a .table opened as a document both draw.

import type { View } from "@workspace.sh/table-core";
import { BoardView, CalendarView, GalleryView, ListView, TableView } from "@workspace.sh/table-ui";
import type { ViewProps } from "@workspace.sh/table-ui/shared";

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
