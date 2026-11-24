# JSON Schema conformance cases

Cases for the JSON Schemas of a `.table`'s files ([`schema/`](../../schema/)) and of its rows (`rowJsonSchema()` in `@workspace.sh/table-core`). SPEC section 9, "JSON Schema", says what the schemas cover and what they leave to a validator.

| File | Checked against | What it holds |
| --- | --- | --- |
| `schema.json.cases.json` | `schema/schema.schema.json` | Field types, ids, constraints, choices, annotations, display, computed fields, keys |
| `views.json.cases.json` | `schema/views.schema.json` | Layouts, filters, sorts, grouping, widths and heights, Sheet views, colour rules, layout-specific fields |
| `meta.json.cases.json` | `schema/meta.schema.json` | A bundle's manifest and a table's own `meta.json`, `source`, `iteration`, Data Package's keys |
| `rows.cases.json` | the schema each table's `schema.json` makes | Each type's encoding, empty values, constraints, choices and multi-select, relations, computed fields |

Each case has a `description`, the `rule` of the spec that decides it (as `SPEC 2, Field constraints`), whether it is `valid`, and the document: `data`, or for rows, a `row` of the table whose `schema` the group gives. An implementation passes when it agrees with every case's `valid`.

`packages/core/src/jsonSchemas.test.ts` runs them with Ajv (strict, union types allowed), runs every example table against the schemas, and checks that the reference validator agrees with every rows case.

One case differs from the reference validator: `a required multi-select that's empty`. The spec says `required` rejects an empty list there (section 2, "Multi-select"), and `valueProblems` doesn't yet.
