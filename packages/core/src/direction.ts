/**
 * Which way a locale's text reads (D40): `rtl` for Arabic, Hebrew and
 * the other right-to-left scripts, `ltr` otherwise. Worked out from the
 * BCP 47 tag itself, not the engine's Intl, so every platform (browsers,
 * Hermes on phones) agrees.
 */

export type TextDirection = "ltr" | "rtl";

/** ISO 15924 scripts written right to left. */
const RTL_SCRIPTS = new Set(["arab", "hebr", "thaa", "syrc", "nkoo", "adlm", "rohg", "mand", "samr"]);

/** Languages whose usual script is one of those, when a tag names no script. */
const RTL_LANGUAGES = new Set([
  "ar", "arc", "ckb", "dv", "fa", "he", "iw", "ks", "nqo", "ps", "sd", "syr", "ug", "ur", "yi",
]);

export function textDirection(locale: string | undefined): TextDirection {
  if (!locale) return "ltr";
  const parts = locale.toLowerCase().split(/[-_]/);
  const script = parts.slice(1).find((p) => p.length === 4 && /^[a-z]+$/.test(p));
  if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.has(parts[0]!) ? "rtl" : "ltr";
}
