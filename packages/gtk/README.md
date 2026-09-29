# `@workspace.sh/table-gtk`

The `.table` views for GTK4 and libadwaita, through GTKX. Same names and
props as `@workspace.sh/table-ui` (`ViewProps`, from `table-ui/shared`),
so an app wires one set of callbacks to either.

What a cell shows (`describeCell`), how wide a column is
(`columnWidths`), how rows group and total, all come from
`table-ui/shared`: the web and GTK views show a table the same way
because they run the same code. Only the drawing is here.

| Export | State |
| --- | --- |
| `TableView` | Read-only: cells, choices as pills, relations, formulas, sheet letters and numbers, groups, totals |
| `CellValue` | A value as GTK widgets |
| `DisplaySettingsProvider` | Locale, date format and formula syntax, as in table-ui |
| `BoardView`, `GalleryView`, `ListView`, `CalendarView` | Next |

It has no build or checks of its own: GTK code can only be typechecked
where GTKX and the machine's bindings are. `apps/linux` typechecks, lints
and tests it (`npm run check` there).
