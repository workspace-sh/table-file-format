// Gives a .table's rows and views z-base-32 ids (D23) and its fields ids
// (D62), rewriting everything inside it that names one: relations, pages,
// a view's saved order, hidden rows, row heights and merged cells, filters
// on a relation, cells' own formulas, history, and the ids formulas name.
// Each new id comes from the old one alone, so a rerun gives the same, and
// an old id has one new one wherever it's used (ids need only be unique
// within their table); ids already in z-base-32's form are kept. Written back by core, as
// an app saves.
//
//   node --conditions=source --import tsx scripts/zbase32-ids.mts <map.json> <bundle>…
//
// <map.json> is written with each old id and its new one, by bundle and
// table, for links into the bundles from elsewhere (Markdown, tests).

import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { ID_ALPHABET, ID_LENGTH } from "../packages/core/src/id.ts";
import { fixtureId } from "./fixture-ids.mts";
import { readBundle, writeBundleTo } from "../packages/core/src/io.ts";
import { nodeFs } from "../packages/core/src/node-fs.ts";
import { parseExpr, type Expr } from "../packages/core/src/expr.ts";
import { formatExpr } from "../packages/core/src/formula.ts";
import type { ParsedTable, View } from "../packages/core/src/types.ts";

const [mapPath, ...bundles] = process.argv.slice(2);
if (!mapPath || bundles.length === 0) {
  console.error("usage: scripts/zbase32-ids.mts <map.json> <bundle>…");
  process.exit(1);
}

const IS_ID = new RegExp(`^[${ID_ALPHABET}]{${ID_LENGTH}}$`);

type Ids = { rows: Map<string, string>; views: Map<string, string> };
const map: Record<string, Record<string, { rows: Record<string, string>; views: Record<string, string> }>> = {};

for (const dir of bundles) {
  const bundle = await readBundle(nodeFs, dir);
  const name = basename(dir);
  const ids: Record<string, Ids> = {};
  const fresh = (old: string, key: string) => (IS_ID.test(old) ? old : fixtureId(key));
  for (const [t, table] of Object.entries(bundle.tables)) {
    ids[t] = {
      rows: new Map(table.rows.map((r) => [r.id, fresh(r.id, `row/${r.id}`)])),
      views: new Map(table.views.map((v) => [v.id, fresh(v.id, `view/${v.id}`)])),
    };
  }
  const row = (t: string, id: string) => ids[t]?.rows.get(id) ?? id;

  for (const [t, table] of Object.entries(bundle.tables)) {
    const own = ids[t]!;
    const relationOf = new Map(table.schema.fields.filter((f) => f.relation).map((f) => [f.name, f.relation!.table]));
    const linked = (field: string, value: unknown): unknown => {
      const to = relationOf.get(field);
      if (!to) return value;
      if (typeof value === "string") return row(to, value);
      if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? row(to, v) : v));
      return value;
    };

    // A formula's ids: a row by id (field, at, range…, in this table or the one it names) and a Sheet view.
    const expr = (text: string): string => {
      const parsed = parseExpr(text);
      if (!parsed.ok) return text;
      let changed = false;
      const walk = (e: Expr, tableNamed?: string): Expr => {
        if (e.kind === "string") {
          const there = tableNamed ?? t;
          const to = own.views.get(e.value) ?? ids[there]?.rows.get(e.value);
          if (to && to !== e.value) {
            changed = true;
            return { kind: "string", value: to };
          }
          return e;
        }
        if (e.kind !== "call") return e;
        // (field "f" "row" "table"): the row is that table's.
        const named = e.fn === "field" && e.args[2]?.kind === "string" ? e.args[2].value : undefined;
        return { ...e, args: e.args.map((a, i) => (e.fn === "field" && i === 2 ? a : walk(a, named))) };
      };
      const out = walk(parsed.expr);
      return changed ? formatExpr(out) : text;
    };

    table.rows = table.rows.map((r) => {
      const out: Record<string, unknown> = { id: own.rows.get(r.id) ?? r.id };
      for (const [k, v] of Object.entries(r)) if (k !== "id") out[k] = linked(k, v);
      return out as typeof r;
    });
    if (table.bodies) table.bodies = Object.fromEntries(Object.entries(table.bodies).map(([id, text]) => [own.rows.get(id) ?? id, text]));
    if (table.rowFiles) table.rowFiles = table.rowFiles.map((f) => ({ ...f, ids: f.ids.map((id) => own.rows.get(id) ?? id) }));
    if (table.cells) table.cells = table.cells.map((c) => ({ ...c, id: own.rows.get(c.id) ?? c.id, ...(c.expr ? { expr: expr(c.expr) } : {}) }));
    table.schema = {
      ...table.schema,
      fields: table.schema.fields.map((f) => (f.computed ? { ...f, computed: { ...f.computed, expr: expr(f.computed.expr) } } : f)),
    };
    table.views = table.views.map((v): View => {
      const out: View = { ...v, id: own.views.get(v.id) ?? v.id };
      if (v.order) out.order = v.order.map((id) => own.rows.get(id) ?? id);
      if (v.hidden) out.hidden = v.hidden.map((id) => own.rows.get(id) ?? id);
      if (v.rowHeights) out.rowHeights = Object.fromEntries(Object.entries(v.rowHeights).map(([id, h]) => [own.rows.get(id) ?? id, h]));
      if (v.filter) out.filter = v.filter.map((c) => ("value" in c ? { ...c, value: linked(c.field, c.value) } : c)) as View["filter"];
      if (v.merged) out.merged = JSON.parse(JSON.stringify(v.merged), (k, value) => (k === "row" && typeof value === "string" ? own.rows.get(value) ?? value : value));
      return out;
    });
    (map[name] ??= {})[t] = { rows: Object.fromEntries(own.rows), views: Object.fromEntries(own.views) };
    void (table as ParsedTable);
  }
  await writeBundleTo(nodeFs, dir, bundle);
  console.log(`${name}: ${Object.values(ids).reduce((n, i) => n + i.rows.size, 0)} rows, ${Object.values(ids).reduce((n, i) => n + i.views.size, 0)} views`);
}
writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n");
