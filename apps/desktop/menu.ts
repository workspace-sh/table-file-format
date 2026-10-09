// The app's own items in the menu bar (native/TablePanels/TableMenu.m):
// set from here, and chosen (or their key pressed) back to here by id.

import { NativeEventEmitter, NativeModules } from "react-native";

type Modifier = "command" | "shift" | "option" | "control";

interface TableMenuModule {
  setItem(
    id: string,
    menu: string,
    title: string,
    key: string,
    modifiers: Modifier[],
    before: string,
    checked: boolean,
    enabled: boolean,
  ): void;
  copyText(text: string): void;
  postKey(characters: string, keyCode: number, modifiers: Modifier[]): void;
  postClick(x: number, y: number): void;
  titles(menu: string): Promise<string[]>;
  setWindowWidth(width: number): void;
  replyToQuit(quit: boolean): void;
  setUnsaved(unsaved: boolean): void;
  pressAlertButton(title: string): Promise<boolean>;
  addListener(event: string): void;
  removeListeners(count: number): void;
}

const TableMenu = NativeModules.TableMenu as TableMenuModule | undefined;
const events = TableMenu ? new NativeEventEmitter(TableMenu) : null;

export interface MenuItem {
  id: string;
  /** The top-level menu it's in: "View". */
  menu: string;
  title: string;
  /** Its key equivalent, as typed: "b". */
  key: string;
  modifiers: Modifier[];
  /** Put it before the item with this title; last when absent. */
  before?: string;
  /** Shown ticked. */
  checked?: boolean;
  /** False greys it out. */
  enabled?: boolean;
}

/** Add the item, or update its title and key. */
export function setMenuItem(item: MenuItem): void {
  TableMenu?.setItem(
    item.id,
    item.menu,
    item.title,
    item.key,
    item.modifiers,
    item.before ?? "",
    item.checked ?? false,
    item.enabled ?? true,
  );
}

/** Put text on the clipboard. */
export function copyText(text: string): void {
  TableMenu?.copyText(text);
}

/** Call `then` with an item's id when it's chosen. Returns the unsubscribe. */
export function onMenu(then: (id: string) => void): () => void {
  const sub = events?.addListener("menu", (e: { id: string }) => then(e.id));
  return () => sub?.remove();
}

/**
 * Before the app quits (⌘Q, or closing its last window): `ready` resolves
 * true to quit, false to stay open. Returns the unsubscribe.
 */
export function onQuit(ready: () => Promise<boolean>): () => void {
  const sub = events?.addListener("quit", () => {
    ready().then(
      (quit) => TableMenu?.replyToQuit(quit),
      () => TableMenu?.replyToQuit(true),
    );
  });
  return () => sub?.remove();
}

/** Whether there are edits left to write: macOS won't end the app suddenly while there are. */
export function setUnsaved(unsaved: boolean): void {
  TableMenu?.setUnsaved(unsaved);
}

/** Development: press a key, as typed (keyCode is the Mac virtual key: b is 11). */
export function postKey(characters: string, keyCode: number, modifiers: Modifier[]): void {
  TableMenu?.postKey(characters, keyCode, modifiers);
}

/** Development only: click at a point, measured from the content's top left. */
export function postClick(x: number, y: number): void {
  TableMenu?.postClick(x, y);
}

/** Development: a menu's item titles, with their keys, as the menu bar has them. */
export function menuTitles(menu: string): Promise<string[]> {
  return TableMenu?.titles(menu) ?? Promise.resolve([]);
}

/** Development: resize the window to this width in points, as dragging its edge would. */
export function setWindowWidth(width: number): void {
  TableMenu?.setWindowWidth(width);
}

/** Development: click the button titled so in the alert on screen; resolves whether there was one. */
export function pressAlertButton(title: string): Promise<boolean> {
  return TableMenu?.pressAlertButton(title) ?? Promise.resolve(false);
}
