/**
 * Web: the browser's own question, as the web app asks its others. Native
 * has `confirm.ts`.
 */
import type { ConfirmQuestion } from "./confirm";

export type { ConfirmQuestion } from "./confirm";

/** Resolves true when the destructive choice is made. */
export function confirmDestructive(q: ConfirmQuestion): Promise<boolean> {
  return Promise.resolve(typeof window !== "undefined" && window.confirm(`${q.title}\n\n${q.message}`));
}
