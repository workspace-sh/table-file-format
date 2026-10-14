// How long a change of fields takes in a large table's index (#551): the
// app's own index host (indexHost.ts), with nothing drawn. Run from the
// SQLite probe screen's link (`alter=<url of a .table.zip>`, and `drop=<a
// field>` for the field removed, `note` unless said), in a development
// build or a measuring one. Nothing here runs otherwise. The same steps as
// the rig's measurement in LARGE-TABLES.md ("Its fields"): a formula
// added, then a field removed.

import { remoteViewRows } from "@workspace.sh/table-app";
import type { ParsedTable, TableSchema } from "@workspace.sh/table-core";
import { openIndexDatabase, openZip } from "./indexHost";

export interface AlterStep {
  change: string;
  /** Whether it was made in place (false: it would have been built again). */
  inPlace: boolean;
  /** Milliseconds to change the index. */
  alterMs: number;
  /** Milliseconds from then to the first 50 rows of the table in file order, read through the index. */
  firstRowsMs: number;
  /** Milliseconds to fill in what the change left to work out. */
  fillMs: number;
  /** The first 50 rows sorted by the last field, once filled, and how long it took (the index answers in tens of ms; memory, seconds). */
  sorted: { by: string; ms: number };
}

export interface AlterProbe {
  rows: number;
  buildMs: number;
  steps: AlterStep[];
}

const since = (from: number) => Math.round(performance.now() - from);

export async function alterProbe(url: string, drop: string, say: (line: string) => void): Promise<AlterProbe> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const { opened } = await openZip(bytes, [`probe-${Date.now()}`]);
  const [name, held] = Object.entries(opened.bundle.tables).find(([, t]) => t.indexed)!;
  const db = openIndexDatabase(opened.key);
  let from = performance.now();
  const count = await db.ensure(name, held.schema, (done, total) => {
    if (done % 100_000 < 5000) say(`reading ${done} of about ${total}`);
  });
  const buildMs = since(from);
  say(`built ${count} rows in ${buildMs} ms`);
  let version = 1;
  const table = (schema: TableSchema): ParsedTable => ({ ...held, schema, indexed: { count, version: version++ } });

  const step = async (change: string, before: TableSchema, to: TableSchema): Promise<AlterStep> => {
    from = performance.now();
    const inPlace = await db.alter(name, before, to);
    const alterMs = since(from);
    from = performance.now();
    const all = await remoteViewRows(db.rows, name, table(to), { id: "", name: "", layout: "table" }, "");
    await all.rows(0, 50);
    const firstRowsMs = since(from);
    all.release();
    from = performance.now();
    await db.fill(name, to);
    const fillMs = since(from);
    const by = to.fields.at(-1)!.name;
    from = performance.now();
    const sortedRows = await remoteViewRows(db.rows, name, table(to), { id: "", name: "", layout: "table", sort: [{ field: by, direction: "desc" }] }, "");
    await sortedRows.rows(0, 50);
    const ms = since(from);
    sortedRows.release();
    const result = { change, inPlace, alterMs, firstRowsMs, fillMs, sorted: { by, ms } };
    say(`${change}: ${JSON.stringify(result)}`);
    return result;
  };

  const steps: AlterStep[] = [];
  let schema = held.schema;
  // Three times the first number field, as the rig's measurement adds `(* amount 3)`.
  const number = schema.fields.find((f) => f.type === "number" && !f.computed);
  const expr = number ? `(* (field ${JSON.stringify(number.name)}) 3)` : "(* 3 2)";
  const formula: TableSchema = { ...schema, fields: [...schema.fields, { name: "probe_formula", type: "number", computed: { dialect: "table-expr-v1", expr } }] };
  steps.push(await step("formula added", schema, formula));
  schema = formula;
  if (schema.fields.some((f) => f.name === drop)) {
    const without: TableSchema = { ...schema, fields: schema.fields.filter((f) => f.name !== drop) };
    steps.push(await step(`${drop} removed`, schema, without));
  } else say(`no field ${drop} to remove`);
  return { rows: count, buildMs, steps };
}
