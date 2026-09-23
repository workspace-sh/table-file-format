/**
 * Value encodings — one JSON spelling per field type (SPEC section 2
 * "Value encodings", DECISIONS D30). Pure checks, no dependencies, so
 * a reader in any runtime can mirror them line for line.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = "([01]\\d|2[0-3]):[0-5]\\d:([0-5]\\d|60)(\\.\\d+)?";
const TIME_ONLY = new RegExp(`^${TIME}$`);
const DATETIME = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})[Tt]${TIME}(Z|z|[+-]([01]\\d|2[0-3]):[0-5]\\d)?$`);
const N = "\\d+(?:[.,]\\d+)?";
const DURATION = new RegExp(`^P(?:${N}Y)?(?:${N}M)?(?:${N}W)?(?:${N}D)?(?:T(?:${N}H)?(?:${N}M)?(?:${N}S)?)?$`);

/** RFC 3339 full-date, and a real calendar day (`2026-02-30` is not). */
export function isDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** RFC 3339 partial-time: `HH:MM:SS`, optional fraction, no offset. */
export function isTime(value: string): boolean {
  return TIME_ONLY.test(value);
}

/** RFC 3339 date-time; the offset is optional (none = floating). */
export function isDateTime(value: string): boolean {
  const m = DATETIME.exec(value);
  return m !== null && isDate(m[1]);
}

/** ISO 8601 duration with at least one component (`P` and `PT` alone are not). */
export function isDuration(value: string): boolean {
  if (!DURATION.test(value)) return false;
  if (value.endsWith("T")) return false;
  return /\d/.test(value);
}

/**
 * The instant a datetime names, in milliseconds, for comparison. A
 * floating value (no offset) compares as if it were UTC. NaN when the
 * value is not a datetime.
 */
export function instantOf(value: string): number {
  if (!isDateTime(value)) return NaN;
  const hasOffset = /(Z|z|[+-]\d{2}:\d{2})$/.test(value);
  return Date.parse(hasOffset ? value : `${value}Z`);
}

/** `[longitude, latitude]`, WGS 84 ranges. */
export function isGeopoint(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    Math.abs(value[0] as number) <= 180 &&
    Math.abs(value[1] as number) <= 90
  );
}

/**
 * A GeoJSON object: an object with a string `type`. Earlier reference
 * readers stored GeoJSON as a string of its text; that form is still
 * read, and must parse to the same.
 */
export function isGeoJSON(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return isGeoJSON(JSON.parse(value));
    } catch {
      return false;
    }
  }
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Complete a `time` or `datetime` that omits seconds — what an HTML
 * `time` / `datetime-local` input gives back (`"09:30"`,
 * `"2026-04-01T09:30"`) — to the one spelling the format stores
 * (`"09:30:00"`). Anything else is returned unchanged, including a
 * value that isn't a time at all, so validation still reports it.
 */
export function completeSeconds(type: string, raw: string): string {
  if (type === "time" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return `${raw}:00`;
  if (type === "datetime" && /^\d{4}-\d{2}-\d{2}[Tt]([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return `${raw}:00`;
  return raw;
}
