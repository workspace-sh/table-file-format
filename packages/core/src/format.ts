import type { Field } from "./types.js";

/**
 * Display formatting for a field value from the closed `format`
 * vocabulary (SPEC "Field format"). Stored values are always raw —
 * ISO date strings, decimal numbers, plain text; `format` declares
 * only the display *semantic*, and rendering is locale-aware via the
 * runtime's `Intl`. Unknown / absent formats fall back to a plain
 * string. Never throws — a value that doesn't fit its format degrades
 * to `String(value)`.
 *
 * This returns display *text*. Interactive treatments (markdown
 * rendering, turning a `url`/`email`/`phone` string into a link) are
 * the consumer's job — use `stringFormatKind()` to branch on those.
 */
/**
 * How the app showing a table wants it shown: personal preferences that
 * live outside the `.table/` (SPEC section 4: personal state is app-local).
 * A field's own `format` is the table's choice and always wins; these fill
 * in what the table leaves open.
 */
export interface DisplayOptions {
  /** BCP 47 locale for dates and numbers, e.g. "en-GB". Absent: the runtime's. */
  locale?: string;
  /**
   * The date format for `date` / `datetime` fields that have none of their
   * own, from the same vocabulary (`iso`, `short`, `long`, `weekday`,
   * `relative`). Absent: `iso`, the SPEC default.
   */
  dateFormat?: string;
  /** "Now", for `relative`. Injectable so tests are deterministic. */
  now?: Date;
}

export function formatValue(field: Field | undefined, value: unknown, options: DisplayOptions = {}): string {
  if (value === undefined || value === null || value === "") return "";
  const isDate = field?.type === "date" || field?.type === "datetime";
  const format = field?.format ?? (isDate ? options.dateFormat : undefined);
  if (!format) return String(value);

  switch (field!.type) {
    case "number":
    case "integer":
    case "year":
      return formatNumber(format, value, options.locale);
    case "date":
    case "datetime":
      return formatDate(format, value, options, field!.type === "datetime");
    default:
      // string + everything else: raw text (see stringFormatKind).
      return String(value);
  }
}

/**
 * For string fields, the interactive kind implied by `format` — so a
 * consumer can decide whether to render a link, markdown, or plain
 * text. Returns `"plain"` for non-string fields or unknown formats.
 */
export function stringFormatKind(
  field: Field | undefined,
): "plain" | "markdown" | "url" | "email" | "phone" {
  if (field?.type !== "string") return "plain";
  switch (field.format) {
    case "markdown":
    case "url":
    case "email":
    case "phone":
      return field.format;
    default:
      return "plain";
  }
}

/**
 * An Intl formatter, or null when the platform doesn't have it (Hermes, for
 * one, has no Intl.RelativeTimeFormat) or refuses the options (an unknown
 * currency code or locale). A missing platform piece must never blank an
 * app: each use falls back to a plainer form.
 */
export function tryIntl<T>(make: () => T): T | null {
  try {
    return make();
  } catch {
    return null;
  }
}

function formatNumber(format: string, value: unknown, locale: string | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  // The format asked for, else the locale's plain number, else the bare number.
  const shown = (options?: Intl.NumberFormatOptions): string =>
    tryIntl(() => new Intl.NumberFormat(locale, options).format(n)) ??
    tryIntl(() => new Intl.NumberFormat(locale).format(n)) ??
    String(n);

  if (format === "integer") return shown({ maximumFractionDigits: 0 });
  if (format === "percent") return shown({ style: "percent" });
  if (format === "fraction") return fraction(n, locale);
  if (format.startsWith("scientific:")) return scientific(n, clampDigits(format.slice("scientific:".length)), locale);
  // `:parens` (D53): a negative in brackets, without its sign.
  const parens = format.endsWith(":parens") && (format.startsWith("decimal:") || format.startsWith("currency:"));
  const token = parens ? format.slice(0, -":parens".length) : format;
  const bracketed = (options: Intl.NumberFormatOptions): string => {
    if (!parens || !(n < 0)) return shown(options);
    const positive = tryIntl(() => new Intl.NumberFormat(locale, options).format(-n)) ?? String(-n);
    return `(${positive})`;
  };
  if (token.startsWith("decimal:")) {
    const digits = clampDigits(token.slice("decimal:".length));
    return bracketed({ minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  if (token.startsWith("currency:")) {
    // An unknown ISO 4217 code shows the plain number rather than throwing.
    return bracketed({ style: "currency", currency: token.slice("currency:".length).toUpperCase() });
  }
  if (format.startsWith("duration:")) {
    // Only `duration:seconds` defined so far — value is a second count.
    if (format.slice("duration:".length) === "seconds") {
      return formatDurationSeconds(n);
    }
  }
  return shown();
}

/**
 * `scientific:N` (D53): N fraction digits and a signed exponent of at least
 * two digits, as spreadsheets show it: 12345 is `1.23E+04`. The digits are
 * the locale's.
 */
function scientific(n: number, digits: number, locale: string | undefined): string {
  if (n === 0) return `${plain(0, digits, locale)}E+00`;
  let exponent = Math.floor(Math.log10(Math.abs(n)));
  let mantissa = n / 10 ** exponent;
  // Rounding can carry the mantissa to 10 (9.996 at two digits): one more power of ten.
  if (Math.abs(Number(mantissa.toFixed(digits))) >= 10) {
    exponent += 1;
    mantissa = n / 10 ** exponent;
  }
  const sign = exponent < 0 ? "-" : "+";
  return `${plain(mantissa, digits, locale)}E${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** A number with exactly `digits` fraction digits, in the locale's digits, without grouping. */
function plain(n: number, digits: number, locale: string | undefined): string {
  return tryIntl(() => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(n)) ?? n.toFixed(digits);
}

/**
 * `fraction` (D53): the whole part and the nearest fraction with a
 * denominator below 100, as spreadsheets show it: 1.25 is `1 1/4`. A
 * fraction that rounds to nothing or to one shows as the whole number.
 */
function fraction(n: number, locale: string | undefined): string {
  const negative = n < 0;
  const a = Math.abs(n);
  let whole = Math.floor(a);
  const rest = a - whole;
  let best = { num: 0, den: 1, error: rest };
  for (let den = 2; den < 100; den++) {
    const num = Math.round(rest * den);
    const error = Math.abs(rest - num / den);
    if (error < best.error - 1e-12) best = { num, den, error };
  }
  if (best.num === best.den) {
    whole += 1;
    best = { num: 0, den: 1, error: 0 };
  }
  const int = (x: number) => tryIntl(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(x)) ?? String(x);
  const parts = [whole > 0 || best.num === 0 ? int(whole) : "", best.num > 0 ? `${best.num}/${best.den}` : ""].filter((p) => p !== "");
  const text = parts.join(" ");
  return negative && text !== "0" ? `-${text}` : text;
}

/**
 * A date, or a date and time, in a date format. A date and time keeps its
 * time (#568), in the viewer's own clock: `iso` as `2026-04-01 14:45`, the
 * others in their language's way of writing it.
 */
function formatDate(format: string, value: unknown, { locale, now }: DisplayOptions, withTime = false): string {
  // Accept YYYY-MM-DD and full ISO datetime strings.
  const raw = String(value);
  const d = new Date(raw.length === 10 ? raw + "T00:00:00" : raw);
  if (Number.isNaN(d.getTime())) return raw;
  const timed = withTime && raw.length > 10;

  // Where the platform can't say it the asked-for way, the plain date (and, local, its time).
  const two = (n: number) => String(n).padStart(2, "0");
  const plain = timed ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` : raw.slice(0, 10);
  const time = timed ? (tryIntl(() => d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })) ?? null) : null;
  const withClock = (date: string | null) => (date === null ? plain : time ? `${date}, ${time}` : date);
  switch (format) {
    case "iso":
      return plain;
    case "short":
      return withClock(tryIntl(() => d.toLocaleDateString(locale, { year: "2-digit", month: "numeric", day: "numeric" })));
    case "long":
      return withClock(tryIntl(() => d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })));
    case "weekday":
      return withClock(tryIntl(() => d.toLocaleDateString(locale, { weekday: "long" })));
    case "relative":
      return withClock(formatRelativeDate(d, locale, now ?? new Date()));
    default:
      return plain;
  }
}

function clampDigits(s: string): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 20);
}

function formatDurationSeconds(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  let s = Math.abs(Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return sign + parts.join(" ");
}

/**
 * Coarse relative date — "today", "yesterday", "3 days ago", "in 2
 * weeks". Uses `Intl.RelativeTimeFormat` for the phrasing so it
 * localises; day-granularity to match the format's `date` type. Null where
 * the platform has no RelativeTimeFormat.
 */
function formatRelativeDate(d: Date, locale: string | undefined, now: Date): string | null {
  const startOf = (x: Date) =>
    Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const rtf = tryIntl(() => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
  if (!rtf) return null;
  if (Math.abs(days) >= 365) return rtf.format(Math.trunc(days / 365), "year");
  if (Math.abs(days) >= 30) return rtf.format(Math.trunc(days / 30), "month");
  if (Math.abs(days) >= 7) return rtf.format(Math.trunc(days / 7), "week");
  return rtf.format(days, "day");
}
