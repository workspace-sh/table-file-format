// A date, time or date and time as a system picker holds it (a JS Date)
// and as a cell stores it (SPEC "Value encodings"): "2026-04-01",
// "09:30:00", "2026-09-22T14:30:00Z". Free of any renderer, as shared.ts.

export type DateKind = "date" | "time" | "datetime";

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * The stored value as a Date in the viewer's time: a date at its local
 * midnight, a time on `today`. Null when empty or unreadable, so the
 * picker starts from now.
 */
export function dateOfStored(kind: DateKind, value: unknown, today: Date = new Date()): Date | null {
  if (typeof value !== "string" || value === "") return null;
  if (kind === "date") {
    const m = DATE.exec(value);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  if (kind === "time") {
    const m = TIME.exec(value);
    if (!m) return null;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), Number(m[1]), Number(m[2]), Number(m[3] ?? 0));
  }
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * A picked Date as the cell stores it. A date picked as a day is read in
 * `zone`: iOS hands over the day's local midnight, Material's date
 * picker its UTC midnight. A date and time is stored in UTC.
 */
export function storedOfDate(kind: DateKind, date: Date, zone: "local" | "utc" = "local"): string {
  const two = (n: number) => String(n).padStart(2, "0");
  if (kind === "date") {
    return zone === "utc"
      ? `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`
      : `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  }
  if (kind === "time") return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
