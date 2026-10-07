// Which control draws each slot (controlSlots.ts): the platform's
// default, unless the host passes its own. A partial value is laid over
// the defaults, so an app replaces only what it wants:
//
//   <PlatformControlsProvider value={{ RowActions: MyRowMenu }}>
//
// The defaults are stable components, one per platform (internal/,
// RowActions.ios.tsx and so on), so a view's rows don't remount when the
// provider's value changes identity.

import { createContext, forwardRef, useContext, useMemo, type ReactNode } from "react";
import type { PlatformControls, SelectHandle, SelectProps, SheetProps, ToggleProps } from "./controlSlots";
import { RowActions } from "./internal/RowActions";
import { Select as PlatformSelect } from "./internal/Select";
import { DateInput } from "./internal/DateInput";
import { Toggle as PlatformToggle } from "./internal/Toggle";
import { Sheet as PlatformSheet } from "./internal/Sheet";
import { SettingsForm as PlatformSettingsForm } from "./internal/SettingsForm";

const defaults: PlatformControls = {
  RowActions,
  Select: PlatformSelect,
  DateInput,
  Toggle: PlatformToggle,
  Sheet: PlatformSheet,
  SettingsForm: PlatformSettingsForm,
};

const Context = createContext<PlatformControls>(defaults);

export function PlatformControlsProvider({ value, children }: { value: Partial<PlatformControls>; children: ReactNode }) {
  const { RowActions: rowActions, Select: select, DateInput: dateInput, Toggle: toggle, Sheet: sheet, SettingsForm: settingsForm } = value;
  const merged = useMemo<PlatformControls>(
    () => ({
      RowActions: rowActions ?? defaults.RowActions,
      Select: select ?? defaults.Select,
      DateInput: dateInput ?? defaults.DateInput,
      Toggle: toggle ?? defaults.Toggle,
      Sheet: sheet ?? defaults.Sheet,
      SettingsForm: settingsForm !== undefined ? settingsForm : defaults.SettingsForm,
    }),
    [rowActions, select, dateInput, toggle, sheet, settingsForm],
  );
  return <Context.Provider value={merged}>{children}</Context.Provider>;
}

/** The controls in use here: the host's, else the platform's. */
export function usePlatformControls(): PlatformControls {
  return useContext(Context);
}

/** The Select in use here (the host's, else the platform's), for the views to draw. */
export const Select = forwardRef<SelectHandle, SelectProps>(function Select(props, ref) {
  const { Select: Control } = usePlatformControls();
  return <Control ref={ref} {...props} />;
});

/** The Toggle in use here (the host's, else the platform's), for the views to draw. */
export function Toggle(props: ToggleProps) {
  const { Toggle: Control } = usePlatformControls();
  return <Control {...props} />;
}

/** The Sheet in use here (the host's, else the platform's), for the views to present in. */
export function Sheet(props: SheetProps) {
  const { Sheet: Control } = usePlatformControls();
  return <Control {...props} />;
}
