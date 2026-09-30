// Hermes has no Intl.Locale, PluralRules or RelativeTimeFormat, which
// relative dates ("yesterday") need. FormatJS's polyfills fill them in,
// each only where it's missing,
// with data for the languages the Display settings offer (table-app's
// LOCALES: en, fr, de, es, pt, ja, ar, he). Keep the two lists in step.
// Core falls back to plain forms without them (tryIntl), so a language
// missing here shows plainly rather than failing.
//
// Not DisplayNames: its data is about 1 MB, for currency names in the field
// editor alone, which fall back to the code ("GBP"). These three add about
// 490 KB to the minified bundle (120 KB gzipped).

import "@formatjs/intl-locale/polyfill.js";

import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/es.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-pluralrules/locale-data/ja.js";
import "@formatjs/intl-pluralrules/locale-data/ar.js";
import "@formatjs/intl-pluralrules/locale-data/he.js";

import "@formatjs/intl-relativetimeformat/polyfill.js";
import "@formatjs/intl-relativetimeformat/locale-data/en.js";
import "@formatjs/intl-relativetimeformat/locale-data/fr.js";
import "@formatjs/intl-relativetimeformat/locale-data/de.js";
import "@formatjs/intl-relativetimeformat/locale-data/es.js";
import "@formatjs/intl-relativetimeformat/locale-data/pt.js";
import "@formatjs/intl-relativetimeformat/locale-data/ja.js";
import "@formatjs/intl-relativetimeformat/locale-data/ar.js";
import "@formatjs/intl-relativetimeformat/locale-data/he.js";

