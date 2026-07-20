# Prior art

How `.table/` sits relative to existing formats, and where it's missing
something the others have. Not exhaustive — these are the formats we
looked at while choosing the bones of the spec.

## Thesis

`.table/` is a **portable database that doubles as a spreadsheet**. The
priority order is:

1. **Data integrity** — typed schema, stable row identity, lossless
   round-trip
2. **Portability** — line-oriented files, no proprietary blob,
   implementable in an afternoon
3. **Author intent that round-trips** — views, enum colors, number /
   date format hints, and similar *schema-level* display semantics
   travel with the data, identically for every consumer.

`.table/` has **no private layer**. Anything written into it is visible
to every consumer authorized to read it; there's no per-user state
hidden alongside the rows. User-local preferences (column widths
adjusted in one client, dark mode, which views are pinned to the
sidebar) live OUTSIDE the `.table/` — they're the consuming app's
problem, not the data format's.

"No private layer" refers to per-user *state* — there is no hidden,
per-user divergent view of the data. Per-field *access control* (see
docs/PERMISSIONS.md) is a separate concern: a reader either holds a
field's key or does not, and all key-holders for a field see identical
values. Access granularity is not the same as hidden state.

The dividing line `.table/` draws on display semantics is Notion's:
visual meaning gets encoded as **schema**, not as marks scattered
across cells. "Active = green" is declared once on the field; every
consumer agrees. The format steers authors toward "if it's worth
tracking per row, make it a field" rather than "scribble a color on
it."

Everything below comes back to these positions.

## Formats we compared against

| Format | What it is |
|---|---|
| **CSV** | Comma-separated values. The lowest common denominator interchange format. |
| **Excel SpreadsheetML** ([example](https://en.wikipedia.org/wiki/Microsoft_Office_XML_formats#Excel_XML_spreadsheet_example)) | Microsoft's XML-based spreadsheet format, single-file. Lineage of OOXML / `.xlsx`. |
| **Frictionless Tabular Data Package** ([spec](https://specs.frictionlessdata.io/tabular-data-package/)) | Open Knowledge Foundation's schema-plus-CSV bundle. Closest analogue to `.table/`. |
| **Airtable JSON export** | Airtable's API and export shape. The pragmatic reference for "database app, exportable". |
| **Notion database export** | Notion's markdown + CSV export. Closer to "long-form workspace" than to "structured data". |

## Cross-cutting comparison

| Axis | CSV | Excel XML | Frictionless TDP | Airtable JSON | Notion export | `.table/` |
|---|---|---|---|---|---|---|
| Container | One file | One XML file (or zip of XMLs in `.xlsx`) | Directory of files (`datapackage.json` + CSVs) | One JSON file per table | Folder per page, mixed `.md` + `.csv` | Directory of small files |
| Row payload | Comma-separated values | XML `<Cell><Data>` | CSV row | JSON object | CSV row | NDJSON line (JSON object) |
| Types | None (everything is a string) | Per-cell (`ss:Type`) | Per-field, JSON Schema-like | Per-field, declared in table schema | None in CSV export | Per-field, in `schema.json` |
| Schema | None | None (header row is convention) | First-class (`schema.fields[]`) | First-class | None | First-class (`schema.fields[]`) |
| Row identity | Position | Position | Position (or `primaryKey` column) | Stable record id (`recXXX`) | None | Stable system `id` |
| Cross-record links | None | Cell formulas (`Sheet2!A1`) | Foreign keys via `schema.foreignKeys` | Linked-record field type | Inline markdown links | `relation` + `<path>#row=<id>` address grammar |
| Views | None | Implicit display state | None | First-class | None | First-class (`views.json`) |
| Long-form content | One CSV cell | One spreadsheet cell (up to ~32k chars) | One CSV cell | One field (long-text type) | Body is the markdown file; structured fields in companion CSV | `bodies/{id}.md` per row |
| Binary attachments | Not modelled | Embedded base64 / OLE | External URLs in fields | URL + cached blob | Files alongside the markdown | `attachments/` dir |
| Formulas | None | First-class | None | First-class (formula field type) | None | None |
| Styling | None | First-class (`<Styles>`, conditional formatting) | None | View-level only | None in export | None — UI concern |
| Diff-friendly | Line-oriented ✓ (but no row ids → row reorders churn) | Heavy XML diffs | Line-oriented ✓ | JSON re-serialization can churn | Line-oriented ✓ | Line-oriented + stable row ids ✓ |
| Spec size | RFC 4180 (~10 pages) | ECMA-376 (~6000 pages) | ~50 pages | Proprietary, undocumented edges | Proprietary, undocumented | One markdown file |
| Ecosystem | Universal | Massive | Niche (data science / open data) | Vendor-locked | Vendor-locked | Spike-only |

## Closest analogue: Frictionless Tabular Data Package

If you squint, `.table/` and Frictionless TDP look similar. Both are
directories. Both have a typed schema next to the data. Both target
"open, portable, schema-first tabular data". Differences:

| | Frictionless TDP | `.table/` |
|---|---|---|
| Data file format | CSV (one or more) | NDJSON (one file per table) |
| Schema vocabulary | JSON Table Schema (W3C-aligned) | Own vocabulary — closer to what an app actually needs |
| Multiple tables | Yes, listed in `datapackage.json` | One `.table/` per table; relations point across sibling dirs |
| Row identity | Optional `primaryKey` (user-declared column) | Mandatory system `id` (always present, separate from user-declared primary key) |
| Long-form bodies | Not modelled | `bodies/{id}.md` |
| Views / saved queries | Not modelled | First-class |
| Audience | Data scientists, government open-data publishers | App users editing structured data daily |

Frictionless is more *publishing*-shaped (a dataset you release once,
others consume); `.table/` is more *application*-shaped (a dataset that
gets edited continuously inside an app, by a person).

## Gaps and how we'd close them

Where `.table/` is missing something one of the comparison formats has,
this is what we'd do.

### Computed / formula fields

**Other formats**: Excel has cell-level formulas. Airtable has
formula-field types. Notion has formula property type.

**`.table/` today**: No formula concept. The app computes whatever it
needs in JS at view time.

**Closing the gap**: Add a `computed` field declaration in `schema.json`:

```json
{
  "name": "total",
  "type": "number",
  "computed": {
    "expr": "price * quantity",
    "dialect": "table-expr-v1"
  }
}
```

The expression lives in the schema (one definition, applies to every
row); the computed value lives nowhere on disk (computed on read). We'd
need to spec the expression dialect — minimal start would be field
references + arithmetic + a few stdlib functions (sum, count, today).
That's well-trodden ground — `CEL`, `JSONata`, or Airtable's formula
syntax are reasonable starting points.

**Status**: the `computed` shape is now reserved in SPEC section 2
(issue #34, DECISIONS D21); the evaluator is deferred until a real
consumer motivates the dialect choice. The materialisation question is
settled: **never persisted, recompute on read** — the optional
`index.sqlite` may cache results for query speed.

### Multi-target relations

**Other formats**: Airtable has "linked record" arrays; Notion has
"relation" arrays.

**`.table/` today**: `relation` declarations are single-target
(`relation: { table, field }`). The value in the row is a single id.

**Closing the gap**: Allow `cardinality` on the relation declaration:

```json
{
  "name": "tags",
  "type": "string",
  "relation": {
    "table": "tags",
    "field": "id",
    "cardinality": "many"
  }
}
```

When `cardinality === "many"`, the row's value is an array of ids
instead of a single id. Address grammar can already point at one row
per id; the UI surfaces it as a chip list. Backwards-compatible if we
default `cardinality` to `"one"`.

**Status**: shipped (issue #35, landed in PR #40) — `cardinality` is
in SPEC section 2 and validated in `@workspace.sh/table-core`.

### Rich text in a cell

**Other formats**: Excel has rich-text cells. Notion's property values
can be rich-text segments.

**`.table/` today**: A row has a body (`bodies/{id}.md`) for long-form
markdown content. Cell-level rich text isn't modelled — fields are
plain strings.

**Closing the gap**: Cell-level rich text is best modelled as markdown
in the cell value plus a `format: "markdown"` declaration in the field
schema (we already have `format: "markdown"` for the `summary` field in
the projects fixture — currently rendered as plain text by the views,
but the declaration is in place). Adding a real markdown renderer for
those cells is a UI concern, not a format change.

For richer needs (inline images, embeds, links to other rows from
inside a cell) the right answer is probably "use a body". Bodies
already render full markdown; cells should stay simple.

### Revision history

**Other formats**: Notion has revision history (vendor-managed, not in
the export). Excel has "track changes" inside one file.

**`.table/` today**: Versioning is delegated to git (DECISIONS.md
D14). Diff-friendly NDJSON makes this work well.

**Closing the gap**: If a non-git audience needs it, we'd ship a
`history.ndjson` extension that logs row-id → before/after diffs. Issue
already exists (#10, parked). The format is spec'd; nothing's blocking
implementing it once we have a consumer that needs it.

### Cell-level decoration (Excel-style)

**Other formats**: Excel — conditional formatting rules, heatmaps, data
bars, manual per-cell highlighting, custom fonts and borders.

**`.table/` today**: Not modelled. Stays that way.

**Closing the gap**: We don't. If you find yourself wanting to mark a
specific cell with a color or flag, the format steers you to add a
field instead — a `flagged` boolean, a `priority` enum, a `reviewer`
relation. That value is then **typed, named, queryable, and filterable**
(other views can show "flagged rows", schema validation catches
typos), where a free-floating color mark is none of those things.

The Notion / Airtable side of this debate has it right: structured
data beats scattered annotation. The format's job is to make the
structured path easier than the scattered path. See the next section
for what `.table/` does model in the display-semantics space.

### Schema-encoded display semantics (Notion / Airtable-style)

**Other formats**: Notion has per-option colors on Select / Multi-Select
properties, per-property type formatting (currency, percent, date
formats), and per-property icons. Airtable has the same surface plus
view-level conditional record coloring driven by formulas.

**`.table/` today**: Partially there but not declarative:

- The UI assigns enum colors algorithmically from value strings
  (`active` happens to be green, `done` happens to be blue) — author
  intent isn't captured in the schema, so two consumers can disagree.
- `format: "markdown"` exists on string fields and is honoured by the
  body editor; nothing similar on numbers or dates.
- Field display name comes from `field.title`; no description / hover
  hint / icon.

**Closing the gap**: This is the right place to invest, and it stays
true to "data carries meaning, presentation respects intent." Concrete
schema additions:

#### Per-enum-value display config

Allow enum entries to be either strings (current shape, preserved) or
objects with display metadata:

```json
{
  "name": "status",
  "type": "string",
  "constraints": {
    "enum": [
      { "value": "planning", "color": "gray",   "label": "Planning" },
      { "value": "active",   "color": "green",  "label": "Active"   },
      { "value": "on-hold",  "color": "yellow", "label": "On hold"  },
      { "value": "done",     "color": "blue",   "label": "Done"     }
    ]
  }
}
```

Colors stay **symbolic** (`green`, not `#22c55e`) so consumers can map
them to their own theme / dark mode / accessibility-adjusted palette.
The 8-color Notion / Linear palette (`gray`, `red`, `orange`, `yellow`,
`green`, `blue`, `purple`, `pink`) covers most cases. Labels are
display-only; the underlying value is what gets stored in rows.

Parsers MUST accept the legacy string form (`enum: ["active", ...]`)
and coerce to `{ value }` with no color. Forwards-compatible.

#### Number format

A `format` string on number fields tells consumers how to display the
value. The set is closed (portable enum), not arbitrary printf:

| `format` | Example input → output |
|---|---|
| `"integer"` | `1234.5` → `1,235` |
| `"decimal:2"` | `1.5` → `1.50` |
| `"percent"` | `0.5` → `50%` |
| `"currency:USD"` | `1234.5` → `$1,234.50` |
| `"currency:EUR"` | `1234.5` → `€1,234.50` |
| `"duration:seconds"` | `90` → `1m 30s` |

Locale-aware separators / symbols are the consumer's responsibility
(`Intl.NumberFormat` does the right thing for free); the format value
declares the *semantic*, not the rendered string.

#### Date format

Similar closed set on date / datetime fields:

| `format` | Example output |
|---|---|
| `"iso"` (default) | `2026-04-15` (raw round-trip) |
| `"short"` | `4/15/26` (locale-aware) |
| `"long"` | `April 15, 2026` |
| `"relative"` | `2 days ago` |
| `"weekday"` | `Wednesday` |

Underlying value stays ISO-8601; the format hints display intent.

#### String format extensions

Currently `format: "markdown"` is the only honoured value. Extend to
the small set consumers can render specially:

- `"plain"` (default) — text
- `"markdown"` — render as markdown
- `"url"` — render as link
- `"email"` — render as `mailto:`
- `"phone"` — render as `tel:`

#### Field description / icon

```json
{
  "name": "budget",
  "type": "number",
  "format": "currency:USD",
  "title": "Budget",
  "description": "Approved Q1 budget, USD",
  "icon": "💰"
}
```

`description` surfaces as hover-help / accessibility text; `icon` is
optional and consumers can ignore it. Both are author-intent, round-trip
clean.

#### What we won't add (line in the sand)

- **Conditional formatting rules** ("color red if value < 0"). That's a
  programmable rule engine, way too much surface area, and the same
  outcome can be encoded as a derived enum or a status field. If
  someone needs heatmaps they reach for a different tool.
- **Per-row coloring overrides**. Encode the reason as a field.
- **Custom RGB color codes**. Symbolic colors only — the consumer owns
  the palette.

This was the most substantive proposed schema extension in this file,
and it has since **shipped** (issues #31 / #32 / #33, landed in PR
#40): per-enum color/label, the closed `format` vocabulary, and field
`description` / `icon` are all in SPEC section 2 and implemented in
`@workspace.sh/table-core`.

### Multiple tables in one container

**Other formats**: Excel workbook = many sheets. Frictionless TDP =
many CSVs declared in `datapackage.json`. Airtable base = many tables.

**`.table/` today**: One `.table/` is one table. Multiple tables = a
folder of sibling `.table/`s. Relations cross via the address grammar.

**Closing the gap**: Already solved by convention — apps load sibling
`.table/`s from the same workspace directory and resolve relations by
the relation's `table` name (see the address spec). No format change
needed; just an app pattern.

### Cell range references in formulas

**Other formats**: Excel's `A1:A10` notation.

**`.table/` today**: No formula syntax at all (see "Computed fields"
above). If we ever add one, range references don't translate — there
are no positional cells, only row ids. The equivalent would be "all
rows in this table that match a filter" — i.e., a view + an
aggregation, not a range.

That's actually a feature, not a gap. Position-based references break
when rows get reordered; id + filter references survive.

### Discoverability / ecosystem

**Other formats**: Excel can be opened by anything. CSV by everything.
Airtable / Notion locked to their vendor.

**`.table/` today**: Nothing reads it but this spike.

**Closing the gap**: Three concrete moves to lower the activation
energy for "another tool to read this":

1. Ship a `fromCSV` / `toCSV` converter (issue #5 — **shipped** in PR
   #41: RFC 4180, schema-coerced import, lossy-export warnings) so
   users can land their existing data here without writing JSON by
   hand.
2. Ship the portable reference core in Rust (#19) so non-JS apps can
   read/write `.table/` without rewriting the parser.
3. Document a "minimum viable reader" — what you need to implement to
   say "I support `.table/`" (probably: parse `schema.json` + iterate
   `rows.ndjson`; everything else optional). Currently implicit in the
   SPEC; should be a section.

Ecosystem is a slow grind. The format being implementable in an
afternoon is the lever — `.table/` doesn't win against Excel on
features; it wins against Excel on "how long does it take a new tool
to add support".

## What lives OUTSIDE a `.table/`

Spelling out the negative space, because it informs several of the
"closing the gap" decisions above:

- **Per-user UI preferences** — which views are pinned to a sidebar,
  column-width adjustments made in one client, dark / light mode,
  hidden columns per-user. The consuming app stores these in its own
  local settings; they don't write back to the `.table/`. A user
  shrinking a column in their copy of the app doesn't change what
  every other authorized consumer sees.
- **Selection / cursor state** — what cell the user is currently
  editing, scroll position, the row they tapped open. Transient,
  per-session, never persisted.
- **Authentication / permissions** — who's allowed to read or write
  this `.table/`. Out of band — handled by the surrounding workspace,
  filesystem permissions, or sync-engine ACLs. The file format itself
  doesn't carry an ACL.
- **Computed view results** — if a view filters down to N rows or
  groups them by status, the *result* of that computation isn't stored;
  the view *definition* is stored in `views.json` and re-applied on
  read.

The rule of thumb: if it's shared truth about the data, it lives in
the `.table/`. If it's about how one consumer chose to look at it
this morning, it doesn't.

## What this file is not

- Not a sales pitch. Excel and Airtable solve real problems `.table/`
  doesn't try to solve (numerical modelling, large-scale realtime
  multi-user editing). Use the right tool.
- Not exhaustive. We didn't compare against SQLite, Parquet, Arrow,
  HDF5 — all relevant in adjacent niches, none competing in the same
  "portable data for an app's UI" space.
- Not frozen. Add formats here as we find them.
