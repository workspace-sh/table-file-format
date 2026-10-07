// iOS: asking for a name (a new table, a new .table file) is the system's
// own prompt, UIKit's alert with a text field (React Native's
// Alert.prompt): the question as its title, Cancel, and the prompt's
// action. Android has no such prompt, so it keeps the shared sheet.

import { useEffect } from "react";
import { Alert } from "react-native";
import type { NameSheetProps } from "./NameSheet";

export type { NameSheetProps } from "./NameSheet";

export function NameSheet({ prompt, onAnswer }: NameSheetProps) {
  useEffect(() => {
    if (prompt === null) return;
    Alert.prompt(prompt.heading, undefined, [
      { text: "Cancel", style: "cancel", onPress: () => onAnswer(null) },
      { text: prompt.action, isPreferred: true, onPress: (name?: string) => onAnswer(name ?? "") },
    ]);
    // Each question once, as it's asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);
  return null;
}
