// A name to type, on the web: the browser's own prompt.
import type { NamePrompt } from "./creating.ts";

export function askName(prompt: NamePrompt, onText: (text: string) => void, onCancel: () => void): void {
  const text = typeof window === "undefined" ? null : window.prompt(prompt.heading, prompt.value ?? "");
  if (text === null) onCancel();
  else onText(text);
}
