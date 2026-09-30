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
| `RowPage` | A row's page (`bodies/{id}.md`), edited as markdown text in a dialog. Save writes it; closing with changes asks first (Keep Editing, Save, Discard). |
| `AttachmentImage` | An attachment drawn as its picture (SVG rendered at the size shown), where `AttachmentsProvider` says where its file is; a missing or non-image file shows by name. Cells show it beside the name; a gallery card leads with it. |
| `EditableCell` | One cell's editor, by `editorKind` from table-ui/shared |
| `CellValue` | A value as GTK widgets |
| `DisplaySettingsProvider` | Locale, date format and formula syntax, as in table-ui |
| `DisplayControls` | The viewer's language, dates and formulas as combo rows, from table-app's `displayChoices`, as the web sidebar and macOS show them |
| `BoardView` | Read-only: a column per choice (empty ones too), cards without the column's field |
| `GalleryView` | Read-only: the hero field, the card's fields, the page's opening lines |
| `ListView` | Read-only: titles, the view's other fields, group headings, page badges |
| `CalendarView` | Read-only: the month in the locale's week, `calendar_range` kept, a day's rows in a dialog |

It has no build or checks of its own: GTK code can only be typechecked
where GTKX and the machine's bindings are. `apps/linux` typechecks, lints
and tests it (`npm run check` there).

Lists edit in place (a multi-select's popover of choices, or a plain list
typed as "a, b, c"). Relations are picked from their related rows. Board cards drag between
columns (taking the column's value) and into place; list rows drag into
order. An attachment cell has a Choose File button when the app gives
`onAttachFile`; the app copies the file into the table's attachments/. Saving is the app's: table-app's edits change a table,
and `table-app/node`'s `saveBundle` writes it. The look follows the GNOME
HIG (libadwaita's cards, navigation sidebar, dialogs) rather than copying
the web views pixel for pixel.
