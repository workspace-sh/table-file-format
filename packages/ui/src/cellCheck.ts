// What a typed cell value becomes, and whether it's saved (D42). A value
// the column can't hold is refused at entry, for the same reasons the
// validator would flag it afterwards, so a table never takes in what it
// would then report as an error. Clearing a cell is always allowed.
// A date before the year 1000 is valid, so it's kept once confirmed; it's
// far more often a year typed short than a historical date.

import { completeSeconds, validate, type Field } from "@workspace.sh/table-core";

/** Typed text as the column stores it: a number, a completed time, or the text itself. */
export function coerceValue(field: Field | undefined, raw: string): unknown {
  if (!field) return raw;
  // Number("") is 0: an emptied number cell is empty, not zero.
  if ((field.type === "integer" || field.type === "number") && raw.trim() === "") return null;
  switch (field.type) {
    case "integer": {
      const n = Number(raw);
      return Number.isInteger(n) ? n : raw === "" ? null : raw;
    }
    case "number": {
      const n = Number(raw);
      return Number.isNaN(n) ? (raw === "" ? null : raw) : n;
    }
    case "boolean":
      return raw === "true";
    case "time":
    case "datetime":
      // The native inputs omit seconds; the format stores them (SPEC "Value encodings").
      return completeSeconds(field.type, raw);
    default:
      return raw;
  }
}

const WHAT: Partial<Record<Field["type"], string>> = {
  number: "a number",
  integer: "a whole number",
  year: "a year, like 2026",
  date: "a date, like 2026-04-01",
  datetime: "a date and time",
  time: "a time, like 09:30",
  duration: "a duration, like PT1H30M",
  boolean: "yes or no",
  geopoint: "a longitude and latitude",
};

export type CellCheck =
  | { ok: true; value: unknown }
  | {
      ok: false;
      message: string;
      /** For a year typed short: the date it probably meant. */
      suggestion?: string;
      /** Saved anyway if confirmed: a valid date in an unlikely year. */
      confirmable?: boolean;
    };

/**
 * Whether typed text can be saved in a column, and as what.
 * `confirmedEarly`: the reader has already been asked about an early year
 * for this very text and chose to keep it.
 */
export function checkEntry(field: Field | undefined, raw: string, confirmedEarly = false): CellCheck {
  const value = coerceValue(field, raw);
  if (!field || value === undefined || value === null || value === "") return { ok: true, value };
  const { required: _required, ...constraints } = field.constraints ?? {};
  const probe: Field = { ...field, constraints };
  const errors = validate({ fields: [probe] }, [{ id: "entry", [field.name]: value }]);
  if (errors.length > 0) {
    const first = errors[0]!.message;
    const typeWrong = first.startsWith("expected type");
    const message = typeWrong && WHAT[field.type] ? `“${raw}” isn't ${WHAT[field.type]}.` : sentence(first);
    return { ok: false, message };
  }
  if ((field.type === "date" || field.type === "datetime") && typeof value === "string" && !confirmedEarly) {
    const year = Number(value.slice(0, 4));
    if (year < 1000) {
      const guess = year < 100 ? String(2000 + year) : undefined;
      return {
        ok: false,
        confirmable: true,
        message: `The year is ${year}.${guess ? ` Did you mean ${guess}?` : ""} Press Enter again to keep it.`,
        ...(guess ? { suggestion: `${guess}${value.slice(4)}` } : {}),
      };
    }
  }
  return { ok: true, value };
}

function sentence(message: string): string {
  const s = message.replace(/^value not in enum: /, "Not one of the choices: ");
  return s.charAt(0).toUpperCase() + s.slice(1) + (s.endsWith(".") ? "" : ".");
}
