// What autosaving a row's page should do with what's been typed. Free of
// any renderer, as shared.ts.

/**
 * - `none`: nothing to save (the text is what's saved);
 * - `save`: keep it;
 * - `ask`: the text has been wiped from a page that had some. Saving it
 *   would delete the page (an empty page is no page, `withBody`), so it
 *   isn't saved as typed: closing asks first.
 */
export type PageSave = "none" | "save" | "ask";

export function pageSave(saved: string, draft: string): PageSave {
  if (draft === saved) return "none";
  // Only spaces is no text: nothing to keep on a new page, and on one
  // with text it would delete the page.
  if (draft.trim() === "") return saved.trim() === "" ? "none" : "ask";
  return "save";
}
