# The `.table` file icon

The icon a `.table` shows in Finder and Files, in both of its forms (a folder or a single file, SPEC section 13): macOS's own document sheet, with the `.table` mark in the middle and "TABLE" along the bottom, the way macOS draws its own types (HTML, PDF, ZIP).

| File | What it is |
|---|---|
| `table-file-mark.svg` | The mark alone, as the sheet carries it: the app icon's glyph (`apps/mobile/assets/icon/AppIcon.icon/Assets/table-glyph.svg`, the same path) with a 12-unit stroke and the sheet's text grey. |
| `table-file-mark-1024.png` | The same, 1024 px, transparent. |
| `table-file.iconset/` | The whole icon at every size macOS asks for, 16 to 1024 px, transparent. |
| `table-file.icns` | Those, as one macOS icon file (`iconutil -c icns table-file.iconset`). |

## How it is made

- **The sheet and "TABLE"** are drawn by macOS: a type declared with `UTTypeIcons` and `UTTypeIconText` `TABLE`, and no image of its own, gets the system's sheet with that word, as macOS draws it for its own types.
- **The mark**: the glyph's path unchanged, filled and stroked (12 units of its 623, round joins) in `#b6b6b6`, the colour macOS draws "TABLE" in, so the two match.
- **Where it sits**, at 1024 px with y measured from the top:
  - its 623-unit square is 44.14% of the icon wide, centred across the page, with the square's centre 47.46% of the icon's height up from the bottom;
  - so the drawing starts at y 373, where macOS's own symbols start, clear of the folded corner, which ends at y 311;
  - and it ends well above "TABLE", whose top is at y 804.

## Using it

An app that declares the `.table` types (SPEC section 13, "Platform types") can either:
- **Let macOS draw the sheet:** give each type `UTTypeIcons` with `UTTypeIconText` `TABLE` and `UTTypeIconBadgeName` naming the mark in the app's asset catalogue. The sheet then follows the system's look in every version.
- **Use `table-file.icns`** as the types' icon, where a whole icon file is wanted.

**When the glyph changes, make these again.**
