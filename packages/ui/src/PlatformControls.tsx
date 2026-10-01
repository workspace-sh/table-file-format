// Which control draws each slot (controlSlots.ts): the platform's
// default, unless the host passes its own. A partial value is laid over
// the defaults, so an app replaces only what it wants:
//
//   <PlatformControlsProvider value={{ RowActions: MyRowMenu }}>
//
// The defaults are stable components, one per platform (internal/,
// RowActions.ios.tsx and so on), so a view's rows don't remount when the
// provider's value changes identity.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PlatformControls } from "./controlSlots";
import { RowActions } from "./internal/RowActions";

const defaults: PlatformControls = { RowActions };

const Context = createContext<PlatformControls>(defaults);

export function PlatformControlsProvider({ value, children }: { value: Partial<PlatformControls>; children: ReactNode }) {
  const { RowActions: rowActions } = value;
  const merged = useMemo<PlatformControls>(() => ({ RowActions: rowActions ?? defaults.RowActions }), [rowActions]);
  return <Context.Provider value={merged}>{children}</Context.Provider>;
}

/** The controls in use here: the host's, else the platform's. */
export function usePlatformControls(): PlatformControls {
  return useContext(Context);
}
