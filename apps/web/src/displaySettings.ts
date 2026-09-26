// How this viewer wants tables shown: locale and default date format.
// Personal, kept in this browser, never in a table (SPEC section 4). Reset
// demo data leaves it alone: it's the viewer's, not the demo's.

import type { DisplayOptions } from "@workspace.sh/table-core";

import type { KeyValueStore } from "./savedTables.ts";

export const DISPLAY_KEY = "table-demo:display";

/** Locales offered, beside the browser's own. */
export const LOCALES = ["en-GB", "en-US", "fr-FR", "de-DE", "es-ES", "pt-BR", "ja-JP"];

/** The date formats an app may default to: SPEC's date vocabulary. */
export const DATE_FORMATS = ["iso", "short", "long", "weekday", "relative"];

export function loadDisplay(store: KeyValueStore | null): DisplayOptions {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(DISPLAY_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const { locale, dateFormat } = parsed as Record<string, unknown>;
    return {
      ...(typeof locale === "string" && LOCALES.includes(locale) ? { locale } : {}),
      ...(typeof dateFormat === "string" && DATE_FORMATS.includes(dateFormat) ? { dateFormat } : {}),
    };
  } catch {
    return {};
  }
}

export function saveDisplay(store: KeyValueStore | null, display: DisplayOptions): void {
  try {
    const { locale, dateFormat } = display;
    store?.setItem(DISPLAY_KEY, JSON.stringify({ locale, dateFormat }));
  } catch {
    // Not kept past a reload; still applied now.
  }
}
