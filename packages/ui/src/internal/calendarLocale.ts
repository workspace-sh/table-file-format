/**
 * Locale-aware calendar primitives via the standard `Intl` API.
 *
 * Everything here is pure JS standard library — no library dependency,
 * cross-platform (works under Hermes, V8, and JSC). Hermes (RN's JS
 * engine) ships with the full ICU `Intl` build, so `DateTimeFormat`
 * and `Locale.getWeekInfo` are both available on iOS / Android /
 * macOS RN runtimes as of RN 0.81+.
 *
 * For older runtimes (or environments that strip ICU), each function
 * has a sensible fallback so the calendar still renders — just with
 * English / Sunday-first defaults.
 */

/** A Sunday in 2024 (Jan 7), used as a reference week for naming. */
const REFERENCE_SUNDAY = new Date(2024, 0, 7);

/**
 * Short weekday names in the locale's order, starting from Sunday.
 * Example en-US: `["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]`.
 * Example fr-FR: `["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."]`.
 */
export function weekdayNamesShort(locale?: string): string[] {
  try {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(REFERENCE_SUNDAY);
      d.setDate(REFERENCE_SUNDAY.getDate() + i);
      return fmt.format(d);
    });
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  }
}

/** Full month name for the given date in the locale (e.g. "April"). */
export function monthNameLong(date: Date, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: "long" }).format(date);
  } catch {
    return date.toLocaleString(locale ?? "en-US", { month: "long" });
  }
}

/**
 * The locale's first day of the week, in `Date.prototype.getDay()`'s
 * numbering (0=Sun, 1=Mon, ..., 6=Sat).
 *
 * Uses `Intl.Locale.prototype.getWeekInfo()` (TC39 Stage 3, shipped in
 * Node 22, modern browsers, Hermes ≥ RN 0.81). Falls back to Sunday
 * (most common worldwide) when unavailable.
 *
 * Note: `getWeekInfo()` returns ISO-style numbering where 1=Mon and
 * 7=Sun. This function converts to JS Date-style numbering.
 */
export function firstDayOfWeek(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? defaultLocale());
    // `getWeekInfo` is newer than the base Intl.Locale type; cast it.
    const info = (loc as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
    }).getWeekInfo?.();
    if (!info) return 0;
    // ISO: 1=Mon ... 7=Sun  →  JS Date: 0=Sun ... 6=Sat
    return info.firstDay === 7 ? 0 : info.firstDay;
  } catch {
    return 0;
  }
}

/**
 * Best guess at the current locale. On RN this is a no-arg
 * `DateTimeFormat`'s resolved option; on web it falls back to
 * `navigator.language`.
 */
function defaultLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

/**
 * Reorder a Sunday-first weekday-name array to start at the given day.
 * E.g. with names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"] and
 * firstDay=1, returns ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].
 */
export function rotateWeekdays<T>(names: T[], firstDay: number): T[] {
  const i = ((firstDay % 7) + 7) % 7;
  return [...names.slice(i), ...names.slice(0, i)];
}
