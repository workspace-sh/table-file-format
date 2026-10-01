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
  if (draft.trim() === "" && saved.trim() !== "") return "ask";
  return "save";
}
