// The app's own items in the menu bar (native/TablePanels/TableMenu.m):
// set from here, and chosen (or their key pressed) back to here by id.

import { NativeEventEmitter, NativeModules } from "react-native";

type Modifier = "command" | "shift" | "option" | "control";

interface TableMenuModule {
  setItem(id: string, menu: string, title: string, key: string, modifiers: Modifier[], before: string, checked: boolean): void;
  postKey(characters: string, keyCode: number, modifiers: Modifier[]): void;
  titles(menu: string): Promise<string[]>;
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
}

/** Add the item, or update its title and key. */
export function setMenuItem(item: MenuItem): void {
  TableMenu?.setItem(item.id, item.menu, item.title, item.key, item.modifiers, item.before ?? "", item.checked ?? false);
}

/** Call `then` with an item's id when it's chosen. Returns the unsubscribe. */
export function onMenu(then: (id: string) => void): () => void {
  const sub = events?.addListener("menu", (e: { id: string }) => then(e.id));
  return () => sub?.remove();
}

/** Development: press a key, as typed (keyCode is the Mac virtual key: b is 11). */
export function postKey(characters: string, keyCode: number, modifiers: Modifier[]): void {
  TableMenu?.postKey(characters, keyCode, modifiers);
}

/** Development: a menu's item titles, with their keys, as the menu bar has them. */
export function menuTitles(menu: string): Promise<string[]> {
  return TableMenu?.titles(menu) ?? Promise.resolve([]);
}
