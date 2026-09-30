// How this viewer wants tables shown: locale, default date format, and
// which syntax formulas are shown in (#76).
// Personal, kept in this browser, never in a table (SPEC section 4). Reset
// demo data leaves it alone: it's the viewer's, not the demo's.

import type { DisplayChoiceRow, DisplaySettingKind, DisplaySettings } from "@workspace.sh/table-ui/shared";

import type { KeyValueStore } from "./savedTables.ts";

export const DISPLAY_KEY = "table-demo:display";

/** Locales offered, beside the browser's own. */
export const LOCALES = ["en-GB", "en-US", "fr-FR", "de-DE", "es-ES", "pt-BR", "ja-JP", "ar-EG", "he-IL"];

/** The date formats an app may default to: SPEC's date vocabulary. */
export const DATE_FORMATS = ["iso", "short", "long", "weekday", "relative"];

/** Excel style, or the stored `table-expr-v1` form. Either can be typed. */
export const FORMULA_SYNTAXES = ["excel", "stored"] as const;

/** How each date format is offered. */
export const DATE_LABELS: Record<string, string> = {
  iso: "ISO (2026-04-20)",
  short: "Short",
  long: "Long",
  weekday: "With weekday",
  relative: "Relative",
};

/** How each formula syntax is offered. */
export const FORMULA_LABELS: Record<(typeof FORMULA_SYNTAXES)[number], string> = {
  excel: "Excel style (=a + b)",
  stored: "Stored form ((+ a b))",
};

/**
 * The Display controls' rows, in order: the language (the viewer's own
 * first: `ownName` and the `ownLocale` it means, "Browser (en-GB)" on the
 * web, "System (en-GB)" in a desktop app), how dates are shown where a
 * column doesn't say, and which syntax formulas are shown in. Each app
 * draws these; only the drawing differs.
 */
export function displayChoices(display: DisplaySettings, ownLocale: string, ownName = "Browser"): DisplayChoiceRow[] {
  return [
    {
      kind: "locale",
      name: "Language",
      label: "Language and region for dates and numbers",
      value: display.locale ?? "",
      options: [{ value: "", label: `${ownName} (${ownLocale})` }, ...LOCALES.map((l) => ({ value: l, label: l }))],
    },
    {
      kind: "dateFormat",
      name: "Dates",
      label: "How dates are shown where a table doesn't say",
      value: display.dateFormat ?? "iso",
      options: DATE_FORMATS.map((f) => ({ value: f, label: DATE_LABELS[f] ?? f })),
      note: "Where a column hasn't chosen its own date format.",
    },
    {
      kind: "formulaSyntax",
      name: "Formulas",
      label: "Which syntax formulas are shown in",
      value: display.formulaSyntax ?? "excel",
      options: FORMULA_SYNTAXES.map((s) => ({ value: s, label: FORMULA_LABELS[s] })),
      note: "Either can be typed. The file keeps one form.",
    },
  ];
}

/** `display` with one row's choice made. A default is stored as absent. */
export function withDisplayChoice(display: DisplaySettings, kind: DisplaySettingKind, value: string): DisplaySettings {
  if (kind === "locale") return { ...display, locale: value || undefined };
  if (kind === "dateFormat") return { ...display, dateFormat: value === "iso" ? undefined : value };
  return { ...display, formulaSyntax: value === "stored" ? "stored" : undefined };
}

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
