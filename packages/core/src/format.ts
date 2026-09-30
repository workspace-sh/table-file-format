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
      return formatDate(format, value, options);
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
  if (format.startsWith("decimal:")) {
    const digits = clampDigits(format.slice("decimal:".length));
    return shown({ minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  if (format.startsWith("currency:")) {
    // An unknown ISO 4217 code shows the plain number rather than throwing.
    return shown({ style: "currency", currency: format.slice("currency:".length).toUpperCase() });
  }
  if (format.startsWith("duration:")) {
    // Only `duration:seconds` defined so far — value is a second count.
    if (format.slice("duration:".length) === "seconds") {
      return formatDurationSeconds(n);
    }
  }
  return shown();
}

function formatDate(format: string, value: unknown, { locale, now }: DisplayOptions): string {
  // Accept YYYY-MM-DD and full ISO datetime strings.
  const raw = String(value);
  const d = new Date(raw.length === 10 ? raw + "T00:00:00" : raw);
  if (Number.isNaN(d.getTime())) return raw;

  // Where the platform can't say it the asked-for way, the plain date.
  const plain = raw.slice(0, 10);
  switch (format) {
    case "iso":
      return plain;
    case "short":
      return tryIntl(() => d.toLocaleDateString(locale, { year: "2-digit", month: "numeric", day: "numeric" })) ?? plain;
    case "long":
      return tryIntl(() => d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })) ?? plain;
    case "weekday":
      return tryIntl(() => d.toLocaleDateString(locale, { weekday: "long" })) ?? plain;
    case "relative":
      return formatRelativeDate(d, locale, now ?? new Date()) ?? plain;
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
