// Whether a table takes the keyboard as it comes into view (macOS), so the
// first arrow selects its first cell without a click. Yes for a table that
// is the page; no for one embedded in a document, which comes into view as
// the document scrolls and would take the keyboard from whatever has it
// (the document's text being typed in, a find field). Clicking a cell there
// gives the table the keyboard as before.
import { createContext } from "react";

export const KeyboardOnShow = createContext(true);
