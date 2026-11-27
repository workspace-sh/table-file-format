// A table's problems (table-core's problemsOf) in the words a person reads,
// for every app to list them the same way: what's wrong as a short title,
// where it is ("amount · row 8 · −5"), what it means, and the fixes with
// their labels as a button says them. A merge conflict, which the reader
// sees as three markers and a repeated id, is one decision here.
//
// Only what is the same on every platform is here; how each app draws it is
// its own (table-file-format#858, part 3).

import { canApplyFix, enumValues, type Fix, type ParsedTable, type Problem, type Severity } from "@workspace.sh/table-core";

/** Where a problem is listed: what has to be decided first, the values, then the rest, warnings and notes last. */
export type ProblemGroup = "decisions" | "values" | "repeated" | "lines" | "formulas" | "file" | "notes";

export const PROBLEM_GROUP_TITLES: Record<ProblemGroup, string> = {
  decisions: "Decisions",
  values: "Values",
  repeated: "Repeated",
  lines: "Lines kept as they were",
  formulas: "Formulas",
  file: "The file",
  notes: "Warnings and notes",
};

/** A fix as a button says it, and what it does beyond its cell, when it does more. */
export interface ProblemFix {
  fixes: Fix[];
  label: string;
  /** "Changes amount for every row." */
  note?: string;
  /** It changes the schema, and so every row. */
  rule: boolean;
  /** It removes something (a line, a formula, a file). */
  removes: boolean;
}

/** Two versions of a row a merge left in, between conflict markers. */
export interface ProblemConflict {
  row: string;
  versions: { side: "ours" | "theirs"; line: number; values: Record<string, unknown>; differs: string[] }[];
  keepOurs: Fix[];
  keepTheirs: Fix[];
  keepBoth: Fix[];
}

export interface ProblemItem {
  /** Stable while the problem is there: a list's key. */
  id: string;
  severity: Severity;
  group: ProblemGroup;
  title: string;
  where: string;
  explain: string;
  /** The cell it's in, to bring into view. */
  cell?: { row: string; field: string };
  /** The row it's in, when it's a row's. */
  row?: string;
  /** A kept line's text, to show as it was. */
  line?: string;
  /** What it checks against, as a few label and value pairs ("Allowed" · "0 or more"). */
  rule: [string, string][];
  /** The fixes this app can make, safest first. */
  fixes: ProblemFix[];
  /**
   * The one fix to offer in a list, as a button beside it: it changes no
   * rule and removes nothing. Absent when the problem needs a decision.
   */
  quick?: ProblemFix;
  /** Said when there's nothing to fix. */
  nothing?: string;
  /**
   * For someone who wants to look closer: where it is in the file, and the
   * lines as they're written. The words above are for anyone; this is not.
   */
  technical?: { where: string; lines: { n: number; text: string }[] };
  conflict?: ProblemConflict;
  /** How many of the library's problems this is: a conflict is four. */
  count: number;
}

const SMALL = new Set(["a", "an", "the", "to", "in", "of", "as", "and", "or", "for", "it"]);
/** A label as a button says it: "Make it 0" is "Make It 0", "Add “paused” as a choice" is "Add “paused” as a Choice". */
export function buttonLabel(label: string): string {
  return label
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) && w !== "it" ? w : /^[a-z]/.test(w) ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const minus = (v: unknown): string => (typeof v === "number" && v < 0 ? `−${-v}` : String(v));
/** A value as it's shown in a line of words: text in quotes, a list joined, nothing as "empty". */
export function shownValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "empty";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "number") return minus(v);
  if (typeof v === "string") return `“${v}”`;
  return JSON.stringify(v);
}
const TYPE_WORDS: Record<string, string> = {
  integer: "whole number",
  number: "number",
  yearmonth: "year and month",
  date: "date",
  datetime: "date and time",
  time: "time",
  year: "year",
  boolean: "yes or no",
  string: "text",
  array: "list",
  object: "set of values",
  duration: "duration",
};
const list = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`);

/** The table's problems as a person reads them, in the order they're listed. */
export function problemItems(table: ParsedTable, problems: readonly Problem[]): ProblemItem[] {
  const rowNumber = new Map(table.rows.map((r, i) => [r.id, i + 1]));
  const rowOf = (id: string) => table.rows.find((r) => r.id === id);
  const fieldOf = (name: string) => table.schema.fields.find((f) => f.name === name);
  const n = (id: string | undefined) => (id !== undefined ? rowNumber.get(id) : undefined);
  const rowWords = (id: string | undefined) => (n(id) !== undefined ? `row ${n(id)}` : "a deleted row");

  const used = new Set<Problem>();
  const items: ProblemItem[] = [];
  const conflict = mergeConflict(table, problems);
  if (conflict) {
    for (const p of conflict.problems) used.add(p);
    items.push({
      id: `conflict:${conflict.item.row}`,
      severity: "error",
      group: "decisions",
      title: `Two versions of ${rowWords(conflict.item.row)}`,
      where: rowWords(conflict.item.row),
      explain: "This row was changed in two places at once, and both versions were kept. Choose the one to keep, or keep both as separate rows.",
      technical: { where: `${conflict.file} · lines ${conflict.first + 1}–${conflict.last + 1}`, lines: conflict.lines },
      row: conflict.item.row,
      rule: [],
      fixes: [],
      conflict: conflict.item,
      count: conflict.problems.length,
    });
  }

  for (const p of problems) {
    if (used.has(p)) continue;
    const d = p.details;
    const at = p.at;
    const field = (d["field"] as string | undefined) ?? (at.kind === "cell" || at.kind === "field" ? at.field : undefined);
    const row = at.kind === "cell" || at.kind === "row" ? at.row : undefined;
    const value = row !== undefined && field !== undefined ? rowOf(row)?.[field] : undefined;
    const cellWhere = `${field} · ${rowWords(row)} · ${shownValue(value)}`;
    const lineWhere = at.kind === "line" ? `${at.file} · line ${at.line + 1}` : "";
    let group: ProblemGroup = "file";
    let title = p.message;
    let where = "";
    let explain = "";
    const rule: [string, string][] = [];
    let nothing: string | undefined;
    switch (p.code) {
      case "value.type": {
        const words = TYPE_WORDS[String(d["expected"])] ?? String(d["expected"]);
        group = "values";
        title = `Not a ${words}`;
        where = cellWhere;
        explain = `${field} holds a ${words}, and this row has ${shownValue(value)}.`;
        break;
      }
      case "value.required":
        group = "values";
        title = "A value is missing";
        where = `${field} · ${rowWords(row)} · empty`;
        explain = `Every row needs a ${field}, and this one has none.`;
        break;
      case "value.choice": {
        const choices = enumValues(fieldOf(field ?? ""));
        group = "values";
        title = `${String(d["value"]).replace(/^"|"$/g, "“").replace(/“$/, "”")} isn’t one of the choices`;
        where = cellWhere;
        explain = `${field} can be ${list(choices.map((c) => `“${c}”`))}.`;
        rule.push(["Choices", choices.join(", ")]);
        break;
      }
      case "value.minimum":
      case "value.maximum": {
        const min = p.code === "value.minimum";
        const dated = /date|time|year/.test(fieldOf(field ?? "")?.type ?? "");
        group = "values";
        title = dated ? `${min ? "Before the earliest" : "After the latest"} date, ${d["limit"]}` : `${min ? "Below the minimum" : "Above the maximum"} of ${minus(d["limit"])}`;
        where = cellWhere;
        explain = dated ? `${field} can’t be ${min ? "before" : "after"} ${d["limit"]}, and this row has ${String(value)}.` : `${field} can’t be ${min ? "less" : "more"} than ${minus(d["limit"])}, and this row has ${minus(value)}.`;
        rule.push(["Allowed", dated ? `${d["limit"]} or ${min ? "later" : "earlier"}` : `${minus(d["limit"])} or ${min ? "more" : "less"}`]);
        break;
      }
      case "value.exclusive-minimum":
      case "value.exclusive-maximum": {
        const min = p.code === "value.exclusive-minimum";
        group = "values";
        title = `Must be ${min ? "above" : "below"} ${minus(d["limit"])}`;
        where = cellWhere;
        explain = `${field} has to be ${min ? "more" : "less"} than ${minus(d["limit"])}, not ${minus(d["limit"])} itself.`;
        break;
      }
      case "value.min-length":
      case "value.max-length": {
        const min = p.code === "value.min-length";
        group = "values";
        title = `${min ? "Shorter" : "Longer"} than ${d["limit"]} characters`;
        where = cellWhere;
        explain = `${field} needs ${min ? "at least" : "at most"} ${d["limit"]} characters, and this has ${d["length"] ?? String(value ?? "").length}.`;
        break;
      }
      case "value.pattern":
        group = "values";
        title = "Not in the right form";
        where = cellWhere;
        explain = `${field} has to match a pattern, and ${shownValue(value)} doesn’t.`;
        rule.push(["Pattern", String(d["limit"])]);
        break;
      case "value.unique":
        group = "repeated";
        title = `Same ${field} as ${rowWords(d["other"] as string)}`;
        where = cellWhere;
        explain = `Each row needs its own ${field}, and ${rowWords(d["other"] as string)} has ${shownValue(value)} too.`;
        break;
      case "key.primary":
      case "key.unique": {
        const fields = String(d["fields"]).split(",");
        const r = row !== undefined ? rowOf(row) : undefined;
        group = "repeated";
        title = `Same ${fields.join(" and ")} as ${rowWords(d["other"] as string)}`;
        where = `${rowWords(row)} · ${fields.map((f) => String(r?.[f] ?? "")).join(", ")}`;
        explain = `No two rows can have the same ${fields.join(" and ")} together, and ${rowWords(d["other"] as string)} and ${rowWords(row)} do.`;
        for (const f of fields) rule.push([f, String(r?.[f] ?? "")]);
        break;
      }
      case "field.id-repeated":
        group = "repeated";
        title = "Two fields share an id";
        where = `${field} and ${d["other"] ?? "another field"}`;
        explain = `The field ${field} has the same id as another. It’s given its own when the table is saved.`;
        break;
      case "id.repeated":
        group = "repeated";
        title = "Two rows share an id";
        where = rowWords(row);
        explain = "Two rows have the same id, so a link or a formula can’t tell them apart.";
        break;
      case "line.not-json":
      case "line.not-row":
      case "id.missing":
      case "line.conflict-marker":
      case "line.id-repeated":
      case "cell.line-unreadable":
        group = "lines";
        title = {
          "line.not-json": "A line that isn’t JSON",
          "line.not-row": "A line that isn’t a row",
          "id.missing": "A row without an id",
          "line.conflict-marker": "A conflict marker",
          "line.id-repeated": "Another version of a row",
          "cell.line-unreadable": "A formula line cut short",
        }[p.code];
        where = p.code === "cell.line-unreadable" ? "a formula the table can’t use" : "a line the table can’t show";
        explain = {
          "line.not-json": "It isn’t JSON, so it can’t be read. It’s kept in the file as it is.",
          "line.not-row": "It’s JSON, but not a row, so it’s kept in the file as it is.",
          "id.missing": "Every row needs an id, so this one is kept in the file as it is and isn’t shown.",
          "line.conflict-marker": "A merge left this marker in the file. It isn’t a row, and goes once the conflict is settled.",
          "line.id-repeated": "It has the id of a row before it, with different values, so it’s kept in the file as it is.",
          "cell.line-unreadable": "It isn’t a formula or a note, so it’s kept in the file as it is.",
        }[p.code];
        break;
      case "line.repeat-left-out":
        group = "notes";
        title = "A line repeated exactly";
        where = "a copy of a row";
        explain = "It’s an exact copy of the row before it, so the copy is left out. Nothing is lost.";
        nothing = "There’s nothing to fix. The copy goes when the table is saved.";
        break;
      case "cell.repeated":
        group = "notes";
        title = "A formula is there twice";
        where = `${field} · ${rowWords(row)}`;
        explain = `The formula for ${field} in this row is written twice. The first one is used.`;
        break;
      case "cell.typed-over":
        group = "notes";
        title = "A value typed over a formula";
        where = cellWhere;
        explain = `${shownValue(value)} was typed over this cell’s formula, so the value is used.`;
        break;
      case "cell.no-field":
      case "cell.no-row":
        group = "formulas";
        title = p.code === "cell.no-field" ? "A formula for a field that isn’t there" : "A formula for a row that isn’t there";
        where = p.code === "cell.no-field" ? `${field} · ${rowWords(row)}` : `${field} · a deleted row`;
        explain = p.code === "cell.no-field" ? `The table has no field called ${field}, so this formula does nothing.` : "Its row was deleted, so this formula does nothing.";
        break;
      case "body.orphaned":
        group = "file";
        title = "A page with no row";
        where = "a deleted row";
        explain = "This page belonged to a row that was deleted.";
        break;
      case "file.malformed":
        group = "file";
        title = "Some of the table’s settings can’t be read";
        where = at.kind === "file" ? at.path : "";
        explain = "A settings file isn’t valid JSON, so the table opens with its defaults.";
        nothing = "There’s no fix for this here yet.";
        break;
      case "bundle.not-a-table":
        group = "notes";
        title = "A folder that isn’t a table";
        where = at.kind === "file" ? at.path : "";
        explain = "It has no schema.json or rows/, so it’s left out.";
        nothing = "There’s nothing to fix. The folder is left as it is.";
        break;
      case "choice.unused":
        group = "notes";
        title = `“${d["value"]}” isn’t used`;
        where = `${field} · no row has it`;
        explain = `“${d["value"]}” is one of ${field}’s choices, but no row uses it.`;
        break;
      case "relation.dangling":
        group = "notes";
        title = "A link to a missing row";
        where = `${field} · ${rowWords(row)}`;
        explain = `${field} links to a row that isn’t in ${d["table"]} any more.`;
        break;
      case "attachment.orphaned":
        group = "notes";
        title = "A file no row holds";
        where = at.kind === "file" ? at.path : "";
        explain = "It’s in the table, but no row has it attached.";
        break;
      case "rows.not-checked":
        group = "notes";
        title = "Not checked row by row";
        where = "";
        explain = "A table this large is read through its index, and its rows aren’t checked one by one.";
        nothing = "There’s nothing to fix.";
        break;
      case "rows.not-checked-since-edit":
        group = "notes";
        title = "Not checked since it was edited";
        where = "";
        explain = "A table this large is read through its index. Its rows were checked as the index was made, and haven’t been since they or the schema were edited.";
        nothing = "There’s nothing to fix.";
        break;
      case "rows.more-problems":
        group = "notes";
        title = "More problems than are listed";
        where = "";
        explain = `The first ${Number(p.details.shown).toLocaleString()} of its ${Number(p.details.total).toLocaleString()} problems are listed, in the order its rows have them.`;
        nothing = "Fixing these shows the next.";
        break;
    }
    if (p.severity !== "error") group = "notes";
    const fixes = p.fixes.filter(canApplyFix).map((f) => fixWords(f, field));
    const quick = fixes.find((f) => !f.rule && !f.removes);
    items.push({
      id: `${p.code}:${JSON.stringify(at)}:${d["value"] ?? ""}`,
      severity: p.severity,
      group,
      title,
      where,
      explain,
      ...(row !== undefined && field !== undefined && at.kind === "cell" ? { cell: { row, field } } : {}),
      ...(row !== undefined ? { row } : {}),
      ...(at.kind === "line" ? { line: at.text, technical: { where: lineWhere, lines: [{ n: at.line + 1, text: at.text }] } } : {}),
      rule,
      fixes,
      ...(quick ? { quick } : {}),
      ...(fixes.length === 0 ? { nothing: nothing ?? "There’s no fix for this here yet." } : {}),
      count: 1,
    });
  }
  const order: ProblemGroup[] = ["decisions", "values", "repeated", "lines", "formulas", "file", "notes"];
  const rank = { error: 0, warning: 1, notice: 2 } as const;
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => order.indexOf(a.item.group) - order.indexOf(b.item.group) || rank[a.item.severity] - rank[b.item.severity] || a.i - b.i)
    .map((x) => x.item);
}

function fixWords(fix: Fix, field: string | undefined): ProblemFix {
  const removes = fix.kind === "remove-line" || fix.kind === "remove-formula" || fix.kind === "remove-file" || fix.kind === "remove-page";
  const note = fix.changesSchema
    ? fix.kind === "change-field" && field
      ? `Changes ${field} for every row.`
      : "Changes the table’s rules, for every row."
    : fix.kind === "remove-line"
      ? `Takes line ${fix.line + 1} out of ${fix.file}.`
      : undefined;
  return { fixes: [fix], label: buttonLabel(fix.label.replace(/(^|\s)-(\d)/g, "$1−$2")), ...(note ? { note } : {}), rule: fix.changesSchema, removes };
}

/** A merge conflict as the reader leaves it: `<<<<<<<`, the row read first, `=======`, another line with its id, `>>>>>>>`. */
function mergeConflict(
  table: ParsedTable,
  problems: readonly Problem[],
): { item: ProblemConflict; problems: Problem[]; file: string; first: number; last: number; lines: { n: number; text: string }[] } | null {
  const markers = problems.filter((p) => p.code === "line.conflict-marker" && p.at.kind === "line");
  const opening = markers.find((p) => p.at.kind === "line" && p.at.text.startsWith("<<<<<<<"));
  if (!opening || opening.at.kind !== "line") return null;
  const file = opening.at.file;
  const lineOf = (p: Problem) => (p.at.kind === "line" ? p.at.line : -1);
  const start = lineOf(opening);
  const middle = markers.find((p) => p.at.kind === "line" && p.at.file === file && p.at.text.startsWith("=======") && lineOf(p) > start);
  const closing = markers.find((p) => p.at.kind === "line" && p.at.file === file && p.at.text.startsWith(">>>>>>>") && lineOf(p) > start);
  if (!middle || !closing) return null;
  const theirs = problems.find((p) => p.code === "line.id-repeated" && p.at.kind === "line" && p.at.file === file && lineOf(p) > lineOf(middle) && lineOf(p) < lineOf(closing));
  if (!theirs || theirs.at.kind !== "line") return null;
  let their: Record<string, unknown>;
  try {
    their = JSON.parse(theirs.at.text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const id = String(their["id"]);
  const ours = table.rows.find((r) => r.id === id);
  if (!ours) return null;
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(their)])].filter((k) => k !== "id");
  const differs = keys.filter((k) => JSON.stringify(ours[k]) !== JSON.stringify(their[k]));
  const remove = (p: Problem): Fix => ({ kind: "remove-line", file, line: lineOf(p), label: "Remove the marker", changesSchema: false });
  const removeMarkers = [opening, middle, closing].map(remove);
  const theirLine = { file, line: lineOf(theirs) };
  return {
    file,
    first: start,
    last: lineOf(closing),
    lines: [
      { n: start + 1, text: opening.at.text },
      { n: start + 2, text: JSON.stringify(ours) },
      ...(middle.at.kind === "line" ? [{ n: lineOf(middle) + 1, text: middle.at.text }] : []),
      { n: lineOf(theirs) + 1, text: theirs.at.text },
      ...(closing.at.kind === "line" ? [{ n: lineOf(closing) + 1, text: closing.at.text }] : []),
    ],
    problems: [opening, middle, closing, theirs],
    item: {
      row: id,
      versions: [
        { side: "ours", line: start + 1, values: { ...ours }, differs },
        { side: "theirs", line: lineOf(theirs), values: their, differs },
      ],
      keepOurs: [{ kind: "remove-line", ...theirLine, label: "Keep this version", changesSchema: false }, ...removeMarkers],
      // The chosen line takes the row's place, and the row read first is kept as that line: removed with it.
      keepTheirs: [{ kind: "choose-line", ...theirLine, label: "Keep this version", changesSchema: false }, { kind: "remove-line", ...theirLine, label: "Keep this version", changesSchema: false }, ...removeMarkers],
      keepBoth: [{ kind: "keep-as-new-row", ...theirLine, label: "Keep both", changesSchema: false }, ...removeMarkers],
    },
  };
}
