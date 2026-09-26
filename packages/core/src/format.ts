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

function formatNumber(format: string, value: unknown, locale: string | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);

  if (format === "integer") {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(n);
  }
  if (format === "percent") {
    return new Intl.NumberFormat(locale, { style: "percent" }).format(n);
  }
  if (format.startsWith("decimal:")) {
    const digits = clampDigits(format.slice("decimal:".length));
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  }
  if (format.startsWith("currency:")) {
    const code = format.slice("currency:".length).toUpperCase();
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).format(n);
    } catch {
      // Unknown ISO 4217 code → plain number rather than throwing.
      return new Intl.NumberFormat(locale).format(n);
    }
  }
  if (format.startsWith("duration:")) {
    // Only `duration:seconds` defined so far — value is a second count.
    if (format.slice("duration:".length) === "seconds") {
      return formatDurationSeconds(n);
    }
  }
  return new Intl.NumberFormat(locale).format(n);
}

function formatDate(format: string, value: unknown, { locale, now }: DisplayOptions): string {
  // Accept YYYY-MM-DD and full ISO datetime strings.
  const raw = String(value);
  const d = new Date(raw.length === 10 ? raw + "T00:00:00" : raw);
  if (Number.isNaN(d.getTime())) return raw;

  switch (format) {
    case "iso":
      return raw.slice(0, 10);
    case "short":
      return d.toLocaleDateString(locale, {
        year: "2-digit",
        month: "numeric",
        day: "numeric",
      });
    case "long":
      return d.toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    case "weekday":
      return d.toLocaleDateString(locale, { weekday: "long" });
    case "relative":
      return formatRelativeDate(d, locale, now ?? new Date());
    default:
      return raw.slice(0, 10);
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
 * localises; day-granularity to match the format's `date` type.
 */
function formatRelativeDate(d: Date, locale: string | undefined, now: Date): string {
  const startOf = (x: Date) =>
    Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(days) >= 365) return rtf.format(Math.trunc(days / 365), "year");
  if (Math.abs(days) >= 30) return rtf.format(Math.trunc(days / 30), "month");
  if (Math.abs(days) >= 7) return rtf.format(Math.trunc(days / 7), "week");
  return rtf.format(days, "day");
}
