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
| `TableView` | Cells, choices as pills, relations, formulas, sheet letters and numbers, groups, totals. With `onUpdateRow`, cells edit in place: text, numbers and dates in an entry, choices in a drop-down, booleans as a check. A value the column can't hold is refused with the reason (D42). `onAddRow` adds a New Row button; `onDeleteRow`, `onInsertRow` and `onOpenBody` fill each row's menu (a button, and a right-click). |
| `FormulaPanel` | A formula cell's dialog: the column's formula as typed and as stored, what it read in this row and others, the result and a changed formula's preview; saving sets it for every row (`onUpdateField`). `TableView` opens it on a click on a formula cell, tinting its column and outlining its inputs. |
| `ViewSettings` | A view's settings as a libadwaita preferences dialog: name, layout (only those the table can use), the field a board, calendar or gallery draws from, Sheet, grouping, filters and sorts, Delete View. Same `ViewSettingsProps` as table-ui's. |
| `FieldEditor`, `AddField` | A field's editor (title, description, formula, format with currency and decimals, alignment, required, deprecated, choices, position) and "add a field" (name, type or formula), as libadwaita dialogs. `TableView` opens the editor from a header and Add Field from its "+". |
| `EditableCell` | One cell's editor, by `editorKind` from table-ui/shared |
| `CellValue` | A value as GTK widgets |
| `DisplaySettingsProvider` | Locale, date format and formula syntax, as in table-ui |
| `BoardView` | Read-only: a column per choice (empty ones too), cards without the column's field |
| `GalleryView` | Read-only: the hero field, the card's fields, the page's opening lines |
| `ListView` | Read-only: titles, the view's other fields, group headings, page badges |
| `CalendarView` | Read-only: the month in the locale's week, `calendar_range` kept, a day's rows in a dialog |

It has no build or checks of its own: GTK code can only be typechecked
where GTKX and the machine's bindings are. `apps/linux` typechecks, lints
and tests it (`npm run check` there).

Lists, relations and attachments are shown but not yet edited, and cards
don't drag yet. Saving is the app's: table-app's edits change a table,
and `table-app/node`'s `saveBundle` writes it. The look follows the GNOME
HIG (libadwaita's cards, navigation sidebar, dialogs) rather than copying
the web views pixel for pixel.
