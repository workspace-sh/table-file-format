# `@workspace.sh/table-gtk`

The `.table` views for GTK4 and libadwaita, through GTKX. Same names and
props as `@workspace.sh/table-ui` (`ViewProps`, from `table-ui/shared`),
so an app wires one set of callbacks to either.

What a cell shows (`describeCell`), how wide a column is
(`columnWidths`), how rows group and total, which board column and
calendar day a card goes in (`boardColumns`, `monthGrid`, `rowsByDay`), all
come from
`table-ui/shared`: the web and GTK views show a table the same way
because they run the same code. Only the drawing is here.

| Export | State |
| --- | --- |
| `TableView` | Read-only: cells, choices as pills, relations, formulas, sheet letters and numbers, groups, totals |
| `CellValue` | A value as GTK widgets |
| `DisplaySettingsProvider` | Locale, date format and formula syntax, as in table-ui |
| `BoardView` | Read-only: a column per choice (empty ones too), cards without the column's field |
| `GalleryView` | Read-only: the hero field, the card's fields, the page's opening lines |
| `ListView` | Read-only: titles, the view's other fields, group headings, page badges |
| `CalendarView` | Read-only: the month in the locale's week, `calendar_range` kept, a day's rows in a dialog |

It has no build or checks of its own: GTK code can only be typechecked
where GTKX and the machine's bindings are. `apps/linux` typechecks, lints
and tests it (`npm run check` there).

Editing, dragging cards and saving come next. The look follows the GNOME
HIG (libadwaita's cards, navigation sidebar, dialogs) rather than copying
the web views pixel for pixel.
