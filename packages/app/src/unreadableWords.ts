// Why a .table couldn't be opened at all, in a person's words: a headline and
// a sentence, with no paths inside an app's container and no parser's or zip
// reader's terms, the same in every app that opens one. What can be done about
// it (Repair, or who to ask) is the app's to add: `note` is said under it.
// Takes what was thrown, or the library's own problem text
// ("“x.table” couldn’t be read: …"), which says the same things.

export type UnreadableKind = "schema-damaged" | "schema-missing" | "not-a-table" | "archive-damaged" | "missing" | "other";

export interface UnreadableWords {
  kind: UnreadableKind;
  title: string;
  detail: string;
  /** For "schema-damaged": the schema's own path as read, and its place inside the table ("tables/items/schema.json"). */
  schema?: { path: string; inside: string };
}

export function unreadableWords(problem: unknown): UnreadableWords {
  const said = typeof problem === "string" ? problem : problem instanceof Error ? problem.message : String(problem);
  const text = said.replace(/^“[^”]*” couldn’t be read: /, "");
  // A schema that isn't JSON, or isn't there (the format's one fatal case): named by its place in the table.
  const schema = /^(\S+): (isn't JSON|there's no )/.exec(text);
  if (schema) {
    const path = schema[1]!;
    const inside = path.replace(/^.*?\.table\//, "").replace(/^.*?\/(tables\/)/, "$1");
    const damaged = schema[2] === "isn't JSON";
    return {
      kind: damaged ? "schema-damaged" : "schema-missing",
      title: "This Table Is Damaged",
      detail: `Its ${inside} ${damaged ? "isn’t valid JSON" : "is missing"}, so the table can’t be read.`,
      ...(damaged ? { schema: { path, inside } } : {}),
    };
  }
  if (/not a zip archive/i.test(text)) return { kind: "not-a-table", title: "Not a Table File", detail: "It holds no tables, so there’s nothing to open or repair." };
  if (/\bzip\b/i.test(text)) return { kind: "archive-damaged", title: "This Table Is Damaged", detail: "Its archive can’t be read." };
  if (/isn’t there any more/.test(text)) return { kind: "missing", title: "File Not Found", detail: "It may have been moved, renamed or deleted." };
  // Anything else as it was said, with any path shortened to its file's name.
  return { kind: "other", title: "Can’t Open This Table", detail: said.replace(/(?:file:\/\/)?\/(?:[^\s/]+\/)+([^\s/]+)/g, "$1") };
}
