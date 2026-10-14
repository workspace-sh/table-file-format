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

## A .table opened as a document: `TableFile`

`TableFile` (also from `@workspace.sh/table-gtk/embed`) is a `.table` opened as a document of its own, for an app that opens files: a `.table` folder, or a `.table.zip`. It opens on the file's first table in its first view, with the file's tables and that table's views to choose between, the row count, a search, New View and View Settings, and the view filling what it is given. Edits are written to the folder and its history and can be undone (Ctrl+Z, Ctrl+Shift+Z). A `.table.zip` is read into memory, has nowhere to be written, and is to look at: it says so. `readOnly` makes a folder the same. A file that can't be opened says why.

```tsx
<TableFile path="/home/me/notes/projects.table" onOpenLink={(address) => open(address)} />
```

## A table inside something else: `@workspace.sh/table-gtk/embed`

`TableEmbed` is the drop-in for an app that shows a `.table` inside a
document (a Markdown file that links to it). The app gives it the link
and where the document is; it reads the file, draws the table, and writes
edits back.

```tsx
import { TableEmbed } from "@workspace.sh/table-gtk/embed";

// `[Tasks](../tables/projects.table#table=tasks&view=v2&embed=1 "Tasks by status")`
<TableEmbed
  address={link.url}
  caption={link.title}
  baseDir={dirname(documentPath)}
  within={workspaceRoot}
  onOpenLink={(address) => open(address)}
/>
```

| Prop | What it is |
| --- | --- |
| `address` | The link's destination as written: a path to the `.table`, then `#table=` and `view=` (SPEC, "Addressing"). Other keys (`embed=1`) are ignored. |
| `baseDir` | The folder the path is relative to: the document's. |
| `within` | The folder the file has to be inside, with links followed. A document can name any path; this keeps it to what the reader opened. |
| `caption` | Shown beneath, small and centred. |
| `maxHeight` | The tallest it is (480 by default) when the link doesn't say. Up to that it is as tall as what it holds; past it, it scrolls within itself. |
| `gutter` | The side margin of the page the embed sits in. A view that scrolls sideways then runs over it to the window's edges: it rests in line with the page's text, passes under the margin as it is scrolled, and stops on the far margin at its end. A first column that stays put stays on the margin. The caption and the lines beneath stay in line with the text. Without it the embed is kept to the width it is given. |
| `readOnly` | To look at only: nothing in it can be changed and nothing is written. For a reader who can't write where the file is. |
| `onOpen` | The table opened as a document of its own: given, an Open button sits at the end of the embed's caption line, and hands the app the file's address at the table and view drawn. |
| `onOpenLink` | A linked row was clicked: its address, for the app to go to. Without it a linked row is its name. |

The link can say how much to show at once (SPEC section 10, "A view
drawn in place"): `rows=5` gives a table or a list the height of five
rows, `cards=3` gives a board three cards down each column and a gallery
the lines that hold three. The rest scrolls within it. That count is
then its height, whatever `maxHeight` is.

With `rest=more` beside the count, only those rows or cards are drawn
and nothing scrolls. A line beneath says how many more there are ("Show
12 more rows") and shows them when pressed; a board's column that has
more says so too ("+2 more"). Totals and counts are still the whole
view's. While rows are left out there is no "+ New row" (a new row
would go after rows that aren't shown) and no empty totals row; both
are back once the rest is shown.

It is the table, not a picture of it. The state is table-app's reducer
(`useEmbeddedTable`, in `table-app/react`), as in an app of its own: cells
edit in place, rows are added and deleted, a view's settings change from
its headers, a row's page opens, Ctrl+Z and Ctrl+Shift+Z undo and redo,
and each edit is written to the file and to the table's history.

What can't be drawn says why in the table's place: no file there, a file
that isn't a `.table`, a table or view the file doesn't have (with the
ones it has), a path outside `within`, and a table of 50,000 rows or
more (those are read through an index, which a document doesn't have
yet). The words are `table-app`'s (`embedIn`), so every platform's
drop-in says the same.

In an embedded view (`EmbeddedContext`), `TableView` and the card views
have no margin of their own above or below, the page's margin (`gutter`)
at their sides, and are as tall as what they hold.

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
