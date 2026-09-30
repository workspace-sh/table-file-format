// A question an app asks before doing something that can't be undone, as
// plain data: each app shows it its own way (window.confirm, an Alert, an
// AdwAlertDialog), and the wording is here, so they all say the same thing.

export interface ConfirmResponse {
  /** What the app gets back: `cancel`, or the action's own id. */
  id: string;
  label: string;
  /** Shown as destructive (red), where the platform does that. */
  destructive?: boolean;
}

export interface Confirm {
  heading: string;
  body: string;
  /** Cancel first; it's also what closing the dialog means. */
  responses: ConfirmResponse[];
}

export const CANCEL: ConfirmResponse = { id: "cancel", label: "Cancel" };

/** A heading and body as one line, for a platform whose dialog takes a single message (window.confirm). */
export function confirmText(c: Confirm): string {
  return `${c.heading} ${c.body}`;
}
