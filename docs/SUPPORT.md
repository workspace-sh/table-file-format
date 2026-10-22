# What's supported

[SPEC.md](SPEC.md) is the format: everything a `.table` can hold, and
what a reader and a writer must do with it. This page is what the apps
in this repository do with it today, part by part, and links each gap
to the issue that tracks it. Nothing leaves the spec for being unbuilt.

Audited against the code at develop `35f7e59` (15 Oct 2026, #560), and
kept current as gaps close.

**Yes** is shown and editable as the spec means it. **Partly** says
what's missing. **No** is planned, with its issue.

The apps: **Web** (`apps/web`), **iOS** (`apps/mobile`), **Mac**
(`apps/desktop`), **Linux** (`apps/linux`). The web, iOS and the Mac
draw the same views (`table-ui`), so they mostly agree; Linux draws its
own (`table-gtk`).

**Android isn't supported yet.** It shares iOS's code, but it hasn't
been run on a device and likely stops at launch: its file module is
Apple's only. What it lacks is listed in #429.

## Files

| | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| Open a `.table` folder | No | No | Yes | Yes | The web's example tables are built in. iOS and the web open archives (below). |
| Open a single-file `.table` | Yes | Yes | Partly | Yes | Linux edits it in place. The web and iOS edit their own copy for now; the Mac's Open takes folders until #571. |
| Save a single-file `.table` in place (D49, D50) | No | No | No | Yes | Edited as a working folder in the cache, packed back after each write. Others: #571 |
| Export as a single file | Yes | Yes | Yes | Yes | From a folder; Linux greys it out for a single file (the others with #571). Large tables up to 250,000 rows (#434). |
| Open a CSV as a new table | Yes | Yes | Yes | Yes | |
| Export a CSV | No | No | No | No | #574 |
| Import a CSV into a table | No | No | No | No | #519 |
| Lines of a table's rows files that can't be read are kept, and said | Partly | Partly | Yes | Yes | Kept everywhere (#569). Said on opening by the Mac and Linux (#574). Large tables from a zip: #567. |
| Warn about a newer `formatVersion` | No | No | No | No | #574 |
| Edit history (`history.ndjson`) | Partly | Partly | Partly | Yes | Web, iOS and the Mac keep it in the app's own storage except for folders and large tables. |

## Field types

What a cell shows, and whether it can be typed in.

| Type | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| `string` | Yes | Yes | Yes | Yes | |
| `number` | Yes | Yes | Yes | Yes | `1e400` is saved as empty, not refused (#568). |
| `integer` | Yes | Yes | Yes | Yes | |
| `boolean` | Yes | Yes | Yes | Yes | |
| `date` | Yes | Yes | Yes | Yes | |
| `datetime` | Partly | Partly | Partly | Partly | Shown with a date format, it loses its time of day (#568). |
| `time` | Yes | Yes | Yes | Yes | |
| `year` | Partly | Partly | Partly | Partly | Shown; a typed year is refused (#568). |
| `array` | Partly | Partly | Partly | Partly | Typed as a comma-separated list; numbers come back as text. |
| `object` | Partly | Partly | Partly | Partly | Shown as JSON; not editable (#572). |
| `duration` | Yes | Yes | Yes | Yes | Typed as ISO 8601 (`PT1H30M`). |
| `geopoint` | Partly | Partly | Partly | Partly | Shown as two numbers; not editable (#572). |
| `geojson` | Partly | Partly | Partly | Partly | Shown as JSON; a typed value is stored as text, not an object (#568). |

## Field settings

| | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| Title, description, alignment | Yes | Yes | Yes | Yes | |
| Number, currency and date formats | Yes | Yes | Yes | Yes | |
| Scientific, fractions, negatives in red or brackets, a unit, grouping | No | No | No | No | #640 |
| A field's style: bold, italic, strike, colours, alignment | No | No | No | No | #640 |
| Choices, with colours and labels | Yes | Yes | Yes | Partly | Linux adds and removes choices; colours and labels are shown, not set. |
| Required | Yes | Yes | Yes | Yes | |
| Minimum, maximum, length, pattern | Partly | Partly | Partly | Partly | Enforced on entry; can't be set (#572). |
| Unique | No | No | No | No | Not checked (#568). |
| Relations: shown, picked, followed | Yes | Yes | Yes | Yes | A dangling one is marked in its cell. |
| Relations: create one | No | No | No | No | #572 |
| Deprecated | Partly | Partly | Partly | Partly | Can be set; still shown in views that list no fields. |
| Attachments | Partly | Partly | Yes | Yes | Web and iOS show them for the example tables and can't attach (#574). `attachment: true` can't be set (#572). |
| Icon | No | No | No | No | #33 |
| Primary key | No | No | No | No | Checked if set; can't be set (#572). |
| Delete a field | Yes | Yes | Yes | Yes | Undoable, values included, on large tables too (#566). |

## Formulas

Formulas mean what OpenFormula says (D38), stored in `.table`'s own
form (SPEC section 2). Typed as in a spreadsheet on every platform.

- **The functions there today:** `sum`, `average`, `count`, `min`,
  `max`, `abs`, `round`, `if`, `and`, `or`, `not`, `isblank`, `len`,
  `upper`, `lower`, `concatenate`, the arithmetic and comparison
  operators, and `.table`'s own forms for other rows and tables:
  `field`, `values`, `related`, `linked`, `at`, `range`, `row`, `rows`
  (D36, D41, D48).
- **Not there yet:** the rest of OpenFormula's 393 functions (#124),
  `^`, `%` and `power`. A function is counted as supported only once
  public test cases check it (D38): LibreOffice's function tests, in
  [conformance/openformula/](../conformance/openformula/README.md),
  whose `REPORT.md` says what each engine meets.
- **A cell's own formula, format and style** (`cells/`, D52): not
  read or written yet (#640).

## Views

| | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| Table, board, list, gallery, calendar | Yes | Yes | Yes | Yes | |
| Sheet views (`=B7`, row numbers kept under a filter) | Yes | Yes | Yes | Yes | |
| Every filter operator | Yes | Yes | Yes | Yes | Two edge cases (#568). |
| Sorts | Yes | Yes | Yes | Partly | Linux can't reorder sorts (#573). |
| Groups | Partly | Partly | Partly | Partly | Number-like groups come out in the wrong order (#568). |
| Totals | Yes | Yes | Yes | Yes | |
| Manual row order | Partly | Partly | Partly | Partly | By dragging in board and list views; not table or gallery (#573). |
| Column widths, single rows' heights | Yes | Yes | Yes | Yes | |
| A view's default row height, a calendar's range | Partly | Partly | Partly | Partly | Honoured; can't be set (#573). |
| Personal arrangements, Save for Everyone | Yes | Yes | Yes | Yes | |

## Rows and pages

| | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| Add, insert (Sheet views), delete rows | Yes | Yes | Yes | Yes | |
| Row pages (`bodies/`) | Yes | Yes | Yes | Yes | Plain markdown text; not rendered. Links in them aren't followed (#575). |
| Undo and redo | Yes | Yes | Yes | Yes | Rows, pages, fields and views. |
| Validation summary | Yes | Yes | Yes | Yes | Large tables aren't checked (#434). Orphan pages and attachments aren't reported (#574). |

## Large tables

Tables of 50,000 rows or more are read through `index.sqlite` and not
held in memory (SPEC section 8, [LARGE-TABLES.md](LARGE-TABLES.md)).

| | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| Held in the index | Partly | Partly | Partly | Partly | Web, iOS and the Mac: tables that arrive in a single file. Linux: folders, and single files (indexed in their working folder). The Mac from a folder: #435. |
| Edit, search, sort, filter at 1,000,000 rows | Yes | Yes | Yes | Yes | Tables with formulas over other rows, or a Sheet view, are held in memory. |
| Change fields in place, undoable | Yes | Yes | Yes | Yes | #551, #556, #562 |
| Two views of one table keep in step | Partly | Partly | Partly | Partly | Edits show in the other view when it next reads (#554). |
| Layouts other than Table | No | No | No | Partly | Linux draws them for up to 5,000 rows in view (narrow with a filter or search); the others say so (#434). |

## Addresses and embeds

| | Web | iOS | Mac | Linux | Notes |
|---|---|---|---|---|---|
| Addresses inside the app (back, forward, linked rows) | Yes | Yes | Yes | Yes | |
| Open an address from outside the app | Yes | No | No | No | Web: its URL. #575 |
| `row=` selects the row; a missing one is said | No | No | No | Partly | Linux's `TableFile` drop-in selects it (#575). |
| A relation's table in a `.table` beside it (D47) | Partly | Partly | Partly | Partly | Read from disk by the embeds; the apps only use files they hold (#575). |
| A table drawn in a document (embed, `rows=`, `cards=`, `rest=`) | Partly | Partly | Partly | Yes | Linux's `TableEmbed`, in Workspace. `table-ui`'s drop-in holds large tables in memory (#515). |
