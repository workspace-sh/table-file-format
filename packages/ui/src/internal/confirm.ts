/**
 * Native default (iOS, Android, macOS): ask in the system's alert before
 * something that can't be taken back. The web asks with the browser's own
 * (`confirm.web.ts`), as its app does for its other questions.
 */
import { Alert } from "react-native";

export interface ConfirmQuestion {
  title: string;
  message: string;
  /** The destructive choice, shown in red. */
  confirm: string;
  /** Going back without it. */
  cancel: string;
}

/** Resolves true when the destructive choice is made. */
export function confirmDestructive(q: ConfirmQuestion): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      q.title,
      q.message,
      [
        { text: q.cancel, style: "cancel", onPress: () => resolve(false) },
        { text: q.confirm, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
