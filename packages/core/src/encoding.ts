/**
 * Value encodings — one JSON spelling per field type (SPEC section 2
 * "Value encodings", DECISIONS D30), answered by the engine
 * (edn/crates/core/src/encoding.rs), which every app shares.
 */

import { call, check, numberOf } from "./engine.js";

/** RFC 3339 full-date, and a real calendar day (`2026-02-30` is not). */
export function isDate(value: string): boolean {
  return check("encoding.isDate", value);
}

/** RFC 3339 partial-time: `HH:MM:SS`, optional fraction, no offset. */
export function isTime(value: string): boolean {
  return check("encoding.isTime", value);
}

/** RFC 3339 date-time; the offset is optional (none = floating). */
export function isDateTime(value: string): boolean {
  return check("encoding.isDateTime", value);
}

/** ISO 8601 duration with at least one component (`P` and `PT` alone are not). */
export function isDuration(value: string): boolean {
  return check("encoding.isDuration", value);
}

/** A year and month, `YYYY-MM` (SPEC section 2). */
export function isYearMonth(value: string): boolean {
  return check("encoding.isYearMonth", value);
}

/**
 * The instant a datetime names, in milliseconds, for comparison. A
 * floating value (no offset) compares as if it were UTC. NaN when the
 * value is not a datetime.
 */
export function instantOf(value: string): number {
  return numberOf("encoding.instantOf", value);
}

// The two checks of a value that isn't text stay here until their caller, the validator, moves
// (table-file-format#867, batch 2). Asked of the engine once per cell, each value would cross as
// JSON: validating 100,000 rows with a 200-point polygon each went from 80 ms to 8.9 s. The
// engine's own copies (edn/crates/core/src/encoding.rs) are what it checks a formula's result by.

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
  return call("encoding.completeSeconds", { type, raw });
}
