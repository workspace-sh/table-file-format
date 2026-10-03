// A touch of feedback for a step in a gesture, such as a row passing a
// line while it's resized. table-ui can't reach a device's haptics, so a
// host that has them supplies them; by default there are none.

import { createContext, useContext } from "react";

export interface Haptics {
  /** One step of a continuous gesture: a light tick. */
  step?: () => void;
}

const Context = createContext<Haptics>({});

export const HapticsProvider = Context.Provider;

export function useHaptics(): Haptics {
  return useContext(Context);
}
