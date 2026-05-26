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
3. **Presentation** — views are first-class, but visual styling is the
   consuming app's job, not the format's

Everything below comes back to that priority order: where another
format wins on "data integrity + portability" we examine why; where
another format wins on presentation we usually decline to follow.

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

Open question: should computed values be **materialised** into
`rows.ndjson` (faster reads, denormalised) or **never persisted** (no
staleness risk)? Default to "never persisted, recompute on read"; let
the optional `index.sqlite` cache them for query speed.

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
§D14). Diff-friendly NDJSON makes this work well.

**Closing the gap**: If a non-git audience needs it, we'd ship a
`history.ndjson` extension that logs row-id → before/after diffs. Issue
already exists (#10, parked). The format is spec'd; nothing's blocking
implementing it once we have a consumer that needs it.

### Cell-level styling / conditional formatting

**Other formats**: Excel. Heavy.

**`.table/` today**: Not modelled. Intentional.

**Closing the gap**: We don't. Styling is a presentation concern, not a
data-format concern. If two apps need to agree on "active = green
pill", they encode it at the field level (enum constraint + a separate
field-level theme manifest at the app layer) — not by writing colour
codes into the row.

If we ever needed to ship a "theme" alongside the data, the right
spot would be a `presentation.json` sibling file, optional and ignored
by formal consumers. Not a near-term need.

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

1. Ship a `fromCSV` / `toCSV` converter (issue #5) so users can land
   their existing data here without writing JSON by hand.
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

## What this file is not

- Not a sales pitch. Excel and Airtable solve real problems `.table/`
  doesn't try to solve (numerical modelling, large-scale realtime
  multi-user editing). Use the right tool.
- Not exhaustive. We didn't compare against SQLite, Parquet, Arrow,
  HDF5 — all relevant in adjacent niches, none competing in the same
  "portable data for an app's UI" space.
- Not frozen. Add formats here as we find them.
