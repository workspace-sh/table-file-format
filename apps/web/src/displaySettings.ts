// How this viewer wants tables shown: locale, default date format, and
// which syntax formulas are shown in (#76).
// Personal, kept in this browser, never in a table (SPEC section 4). Reset
// demo data leaves it alone: it's the viewer's, not the demo's.

import type { DisplaySettings } from "@workspace.sh/table-ui";

import type { KeyValueStore } from "./savedTables.ts";

export const DISPLAY_KEY = "table-demo:display";

/** Locales offered, beside the browser's own. */
export const LOCALES = ["en-GB", "en-US", "fr-FR", "de-DE", "es-ES", "pt-BR", "ja-JP"];

/** The date formats an app may default to: SPEC's date vocabulary. */
export const DATE_FORMATS = ["iso", "short", "long", "weekday", "relative"];

/** Excel style, or the stored `table-expr-v1` form. Either can be typed. */
export const FORMULA_SYNTAXES = ["excel", "stored"] as const;

export function loadDisplay(store: KeyValueStore | null): DisplaySettings {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(DISPLAY_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const { locale, dateFormat, formulaSyntax } = parsed as Record<string, unknown>;
    return {
      ...(typeof locale === "string" && LOCALES.includes(locale) ? { locale } : {}),
      ...(typeof dateFormat === "string" && DATE_FORMATS.includes(dateFormat) ? { dateFormat } : {}),
      ...(formulaSyntax === "stored" ? { formulaSyntax } : {}),
    };
  } catch {
    return {};
  }
}

export function saveDisplay(store: KeyValueStore | null, display: DisplaySettings): void {
  try {
    const { locale, dateFormat, formulaSyntax } = display;
    store?.setItem(DISPLAY_KEY, JSON.stringify({ locale, dateFormat, formulaSyntax }));
  } catch {
    // Not kept past a reload; still applied now.
  }
}
