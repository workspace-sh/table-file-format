// Mending a `schema.json` that isn't JSON: the one fatal case in the format
// (SPEC section 3, "Reader error contract"), so a person has its source to
// correct instead of a table. This says where it stops being JSON, in plain
// words, and for the commonest breaks offers the corrected text. Nothing is
// written: an app shows the source, the suggestion and the person's own edits.

/** What's wrong with a schema's text, and a suggested correction when there's one. */
export type SchemaRepair =
  | { ok: true }
  | {
      ok: false;
      /** The line it goes wrong on, from 0; null when that can't be told. */
      line: number | null;
      /** In plain words, for the person mending it. */
      reason: string;
      /** A corrected text that parses, when the break is a common one. */
      suggestion?: { label: string; text: string };
    };

/**
 * Checks a table's `schema.json` text. It is mended when it is a JSON object
 * with a list of `fields`, which is what a reader needs to open the table.
 */
export function schemaRepair(text: string): SchemaRepair {
  const parsed = tryParse(text);
  if (parsed.ok) {
    const value = parsed.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, line: null, reason: "It’s JSON, but not a table’s schema: it should be an object with a list of fields." };
    }
    if (!Array.isArray((value as { fields?: unknown }).fields)) {
      return { ok: false, line: null, reason: "It’s JSON, but it has no list of fields, so it isn’t a table’s schema." };
    }
    return { ok: true };
  }
  const lines = text.split("\n");
  for (const candidate of candidates(lines)) {
    const mended = candidate.lines.join("\n");
    if (tryParse(mended).ok) return { ok: false, line: candidate.line, reason: candidate.reason, suggestion: { label: candidate.label, text: mended } };
  }
  const at = failsAt(text);
  const line = at === null ? null : text.slice(0, at).split("\n").length - 1;
  return { ok: false, line, reason: line === null ? "It isn’t valid JSON." : `Line ${line + 1} isn’t valid JSON.` };
}

/**
 * Where JSON text stops being JSON, as an offset; null if it doesn't. Engines
 * word their errors differently and some (Hermes) give no place at all, so
 * this reads the text itself.
 */
export function failsAt(text: string): number | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const literal = (word: string) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail();
  };
  const string = () => {
    i++;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') return void i++;
      if (c === "\\") {
        i++;
        if (text[i] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail();
          i += 5;
        } else if (text[i] !== undefined && '"\\/bfnrt'.includes(text[i]!)) i++;
        else fail();
      } else if (c < " ") fail();
      else i++;
    }
    fail();
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m || m[0] === "" || m[0] === "-") fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        string();
        ws();
        if (text[i] !== ":") fail();
        i++;
        value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return void i++;
        else fail();
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return void i++;
        else fail();
      }
    }
    if (c === '"') return string();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    fail();
  };
  try {
    value();
    ws();
    if (i < text.length) fail();
    return null;
  } catch (at) {
    if (typeof at === "number") return Math.min(at, text.length);
    throw at;
  }
}

type Parse = { ok: true; value: unknown } | { ok: false };

function tryParse(text: string): Parse {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

interface Candidate {
  line: number;
  reason: string;
  label: string;
  lines: string[];
}

/** How many of each bracket a line opens and closes, outside its strings. */
function brackets(line: string): { braces: number; squares: number } {
  let braces = 0;
  let squares = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") braces++;
    else if (c === "}") braces--;
    else if (c === "[") squares++;
    else if (c === "]") squares--;
  }
  return { braces, squares };
}

const named = (line: string): string | null => /"name"\s*:\s*"([^"]*)"/.exec(line)?.[1] ?? null;
const nextLine = (lines: readonly string[], i: number): string | null => {
  for (let j = i + 1; j < lines.length; j++) if (lines[j]!.trim() !== "") return lines[j]!.trim();
  return null;
};
const replaced = (lines: readonly string[], i: number, line: string): string[] => lines.map((l, j) => (j === i ? line : l));
/** A line with `closing` put at its end, before a comma it ends with. */
const closed = (line: string, closing: string): string => {
  const trimmed = line.replace(/\s+$/, "");
  return trimmed.endsWith(",") ? `${trimmed.slice(0, -1)}${closing},` : `${trimmed}${closing}`;
};

/** Corrections for the commonest breaks, most likely first; each is tried, and the first that parses is offered. */
function* candidates(lines: readonly string[]): Generator<Candidate> {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const { braces, squares } = brackets(line);
    const next = nextLine(lines, i);
    // An object opened and left open on a line of its own, as a field written on one line.
    if (braces > 0 && !/[{[]\s*$/.test(trimmed) && trimmed !== "{") {
      const name = named(line);
      yield {
        line: i,
        reason: `Line ${i + 1} isn’t closed: ${name === null ? "it" : `the field “${name}”`} is missing its }.`,
        label: "Add the Missing }",
        lines: replaced(lines, i, closed(line, "}")),
      };
    }
    if (squares > 0 && !/[{[]\s*$/.test(trimmed)) {
      yield { line: i, reason: `Line ${i + 1} isn’t closed: it is missing its ].`, label: "Add the Missing ]", lines: replaced(lines, i, closed(line, "]")) };
    }
    // A comma before the end of a list or an object.
    if (trimmed.endsWith(",") && next !== null && /^[}\]]/.test(next)) {
      yield { line: i, reason: `Line ${i + 1} ends with a comma, but nothing comes after it.`, label: "Remove the Extra Comma", lines: replaced(lines, i, line.replace(/,\s*$/, "")) };
    }
    // Two members with no comma between them.
    if (/["}\]\d]\s*$|\b(true|false|null)\s*$/.test(trimmed) && next !== null && /^["{[]/.test(next)) {
      yield { line: i, reason: `Line ${i + 1} is missing the comma at its end.`, label: "Add the Missing Comma", lines: replaced(lines, i, `${line.replace(/\s+$/, "")},`) };
    }
  }
  // The text ends before its brackets do.
  const all = brackets(lines.join("\n"));
  if (all.squares > 0 || all.braces > 0) {
    const last = lines.length - 1;
    const missing = "]".repeat(Math.max(0, all.squares)) + "}".repeat(Math.max(0, all.braces));
    const ending = missing.endsWith("}") ? "}" : "]";
    yield { line: last, reason: `It ends too soon: it is missing its closing ${ending}.`, label: `Add the Missing ${ending}`, lines: [...lines.slice(0, last + 1), missing] };
  }
}
