// The native half (macos/TableMacControls.m): the system's pop-up menu,
// its date picker, and right-clicks asking for a row's menu.

import { NativeEventEmitter, NativeModules } from "react-native";

/** One line of a pop-up menu: something to choose, or a separator. */
export type PopUpItem =
  | { id: string; title: string; checked?: boolean; disabled?: boolean; /** An SF Symbol's name. */ symbol?: string }
  | { separator: true };

interface TableMacControlsModule {
  popUp(items: PopUpItem[], at: { x: number; y: number } | null): Promise<string | null>;
  pickDate(kind: string, date: number | null, rect: { x: number; y: number; width: number; height: number }, anchor: string | null): Promise<number | null>;
  datePickerShown(): Promise<boolean>;
  datePickerSet(date: number): void;
  datePickerClose(): void;
  popUpTitles(): Promise<string[]>;
  popUpChoose(title: string, seconds: number): void;
  setSettingsForm(json: string): void;
  setInspectorShown(shown: boolean): void;
  chooseMany(options: { value: string; label: string; color?: string }[], selected: string[], rect: { x: number; y: number; width: number; height: number }, anchor: string | null): Promise<null>;
  chooseManyClose(): void;
}

const native = NativeModules.TableMacControls as TableMacControlsModule | undefined;
const events = native ? new NativeEventEmitter(native as never) : null;

/**
 * The system's menu of `items`; resolves with the id chosen, or null when
 * it's dismissed. With `at` (a point in the React surface, as React
 * measures) the ticked item opens over it, as a pop-up button's does;
 * without, the menu opens where the click that asked for it landed, as a
 * context menu does.
 */
export function popUpMenu(items: PopUpItem[], at: { x: number; y: number } | null = null): Promise<string | null> {
  return native?.popUp(items, at) ?? Promise.resolve(null);
}

/**
 * The system's date picker in a popover pointing at the view whose
 * `nativeID` is `anchor`, else at `rect` (a cell, as React measures it in
 * its surface): a calendar for a date, a field with a stepper for a time,
 * both for a date and time. Resolves with the date chosen in milliseconds
 * since 1970, or null when nothing changed. Prefer an anchor: React's
 * measurements don't count a native scroll view's offset (a table embedded
 * in a document).
 */
export function pickDate(
  kind: "date" | "time" | "datetime",
  date: number | null,
  rect: { x: number; y: number; width: number; height: number },
  anchor: string | null = null,
): Promise<number | null> {
  return native?.pickDate(kind, date, rect, anchor) ?? Promise.resolve(null);
}

/**
 * A right-click (or Control-click) in a React surface. `target` is the
 * `id` of the nearest element up from the one clicked whose id starts
 * "menu-", or "" when there's none.
 */
export function onContextMenu(then: (target: string) => void): () => void {
  const sub = events?.addListener("contextMenu", (e: { target: string }) => then(e.target));
  return () => sub?.remove();
}

/** Development only: whether the date picker is showing; setting its date as a click in it would; closing it. */
export function datePickerShown(): Promise<boolean> {
  return native?.datePickerShown() ?? Promise.resolve(false);
}
export function datePickerSet(date: number): void {
  native?.datePickerSet(date);
}
export function datePickerClose(): void {
  native?.datePickerClose();
}

/**
 * Development only: the last pop-up menu's titles; and choosing from the
 * next one by title, `seconds` after it opens ("" dismisses it), set
 * before it opens, since nothing reaches the app while a menu is open.
 */
export function popUpTitles(): Promise<string[]> {
  return native?.popUpTitles() ?? Promise.resolve([]);
}
export function popUpChoose(title: string, seconds = 1): void {
  native?.popUpChoose(title, seconds);
}

/** The inspector's settings form (macos/TableInspector.swift), as JSON; "" for none. */
export function setSettingsForm(json: string): void {
  native?.setSettingsForm(json);
}

/** Open or close the inspector. */
export function setInspectorShown(shown: boolean): void {
  native?.setInspectorShown(shown);
}

/** What's done in the inspector's settings form. */
export function onSettingsForm<E>(then: (event: E) => void): () => void {
  const sub = events?.addListener("settingsForm", then);
  return () => sub?.remove();
}

/**
 * Several choices in a popover pointing at the view whose `nativeID` is
 * `anchor`, else at `rect`; each pick goes to `onToggle`. Resolves when it
 * closes.
 */
export function chooseMany(
  options: { value: string; label: string; color?: string }[],
  selected: string[],
  rect: { x: number; y: number; width: number; height: number },
  anchor: string | null,
  onToggle: (value: string) => void,
): Promise<void> {
  if (!native) return Promise.resolve();
  const sub = events?.addListener("choiceToggled", (e: { value: string }) => onToggle(e.value));
  return native.chooseMany(options, selected, rect, anchor).then(
    () => sub?.remove(),
    () => sub?.remove(),
  );
}

/** Close the popover of several choices, if one is open. */
export function chooseManyClose(): void {
  native?.chooseManyClose();
}
