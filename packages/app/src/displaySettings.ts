// How this viewer wants tables shown: locale, default date format, which
// syntax each table's formulas are shown in (#76), and how resize handles look.
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

/** How a selected cell's resize handles look on touch. */
export const RESIZE_HANDLES = ["pills", "grabbers"] as const;

/** How each look is offered. */
export const RESIZE_HANDLE_LABELS: Record<(typeof RESIZE_HANDLES)[number], string> = {
  pills: "Pills",
  grabbers: "Grabbers",
};

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
export function displayChoices(display: DisplaySettings, ownLocale: string, ownName = "Browser", table?: string): DisplayChoiceRow[] {
  const rows: DisplayChoiceRow[] = [
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
      kind: "resizeHandles",
      name: "Resize handles",
      label: "How a selected cell's handles for resizing its row and column look",
      value: display.resizeHandles ?? "pills",
      options: RESIZE_HANDLES.map((h) => ({ value: h, label: RESIZE_HANDLE_LABELS[h] })),
      note: "On touch screens. With a pointer, drag the lines between rows and columns.",
    },
  ];
  // Chosen for the table on screen, so only while there is one.
  if (table !== undefined) {
    rows.splice(2, 0, {
      kind: "formulaSyntax",
      name: "Formulas",
      label: "Which syntax this table's formulas are shown in",
      value: storedFormulasIn(display, table) ? "stored" : "excel",
      options: FORMULA_SYNTAXES.map((s) => ({ value: s, label: FORMULA_LABELS[s] })),
      note: "For this table, on this device. Either can be typed; the file keeps one form.",
    });
  }
  return rows;
}

/** Whether table `table`'s formulas are shown in stored form here. */
export function storedFormulasIn(display: DisplaySettings, table: string): boolean {
  return display.storedFormulaTables?.includes(table) ?? false;
}

/** The display settings for table `table` on screen: its formulas in the syntax chosen for it. */
export function displayFor<T extends DisplaySettings>(display: T, table: string): T {
  const { formulaSyntax: _was, ...rest } = display;
  return (storedFormulasIn(display, table) ? { ...rest, formulaSyntax: "stored" } : rest) as T;
}

/** `display` with one row's choice made; Formulas for table `table`. A default is stored as absent. */
export function withDisplayChoice(display: DisplaySettings, kind: DisplaySettingKind, value: string, table?: string): DisplaySettings {
  if (kind === "locale") return { ...display, locale: value || undefined };
  if (kind === "dateFormat") return { ...display, dateFormat: value === "iso" ? undefined : value };
  if (kind === "resizeHandles") return { ...display, resizeHandles: value === "grabbers" ? "grabbers" : undefined };
  if (table === undefined) return display;
  const others = (display.storedFormulaTables ?? []).filter((t) => t !== table);
  const tables = value === "stored" ? [...others, table] : others;
  const { storedFormulaTables: _was, ...rest } = display;
  return tables.length > 0 ? { ...rest, storedFormulaTables: tables } : rest;
}

export function loadDisplay(store: KeyValueStore | null): DisplaySettings {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(DISPLAY_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    const { locale, dateFormat, storedFormulaTables, resizeHandles } = parsed as Record<string, unknown>;
    const stored = Array.isArray(storedFormulaTables) ? storedFormulaTables.filter((t): t is string => typeof t === "string") : [];
    return {
      ...(typeof locale === "string" && LOCALES.includes(locale) ? { locale } : {}),
      ...(typeof dateFormat === "string" && DATE_FORMATS.includes(dateFormat) ? { dateFormat } : {}),
      ...(stored.length > 0 ? { storedFormulaTables: stored } : {}),
      ...(resizeHandles === "grabbers" ? { resizeHandles } : {}),
    };
  } catch {
    return {};
  }
}

export function saveDisplay(store: KeyValueStore | null, display: DisplaySettings): void {
  try {
    const { locale, dateFormat, storedFormulaTables, resizeHandles } = display;
    store?.setItem(DISPLAY_KEY, JSON.stringify({ locale, dateFormat, storedFormulaTables, resizeHandles }));
  } catch {
    // Not kept past a reload; still applied now.
  }
}

/** The viewer's language: the one they chose, else the platform's (the browser's, the system's). */
export function viewerLocale(display: DisplaySettings, platformLocale: string | undefined): string | undefined {
  return display.locale ?? platformLocale;
}

/**
 * How the viewer's own sorts order text: their language's collation, with
 * numbers in number order (D41: saved sorts use the fixed saved text order
 * instead, the same on every device).
 */
export function viewerOrder(locale: string | undefined): (a: string, b: string) => number {
  return new Intl.Collator(locale || undefined, { numeric: true }).compare;
}
