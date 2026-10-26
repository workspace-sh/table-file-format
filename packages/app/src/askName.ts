// A name to type (a new table's, a cell's note, a range of cells to merge),
// asked in the system's own text prompt: Alert.prompt, which iOS and React
// Native macOS draw as theirs. Where there's none (Android), nothing is asked
// and it's as if cancelled. The web's own is askName.web.ts.
import { Alert } from "react-native";
import type { NamePrompt } from "./creating.ts";

export function askName(prompt: NamePrompt, onText: (text: string) => void, onCancel: () => void): void {
  if (typeof Alert.prompt !== "function") return onCancel();
  Alert.prompt(
    prompt.heading,
    undefined,
    [
      { text: "Cancel", style: "cancel", onPress: onCancel },
      { text: prompt.action, onPress: (text?: string) => onText(text ?? "") },
    ],
    "plain-text",
    prompt.value ?? "",
  );
}
