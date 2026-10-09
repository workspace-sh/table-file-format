// The app's own items in the menu bar (native/TablePanels/TableMenu.m):
// set from here, and chosen (or their key pressed) back to here by id.

import { NativeEventEmitter, NativeModules } from "react-native";

type Modifier = "command" | "shift" | "option" | "control";

/** One line of a pop-up menu: something to choose, or a separator. */
export type PopUpItem =
  | { id: string; title: string; checked?: boolean; disabled?: boolean; /** An SF Symbol's name. */ symbol?: string }
  | { separator: true };

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
  popUp(items: PopUpItem[], at: { x: number; y: number } | null): Promise<string | null>;
  popUpTitles(): Promise<string[]>;
  popUpChoose(title: string, seconds: number): void;
  postRightClick(x: number, y: number): void;
  postClick(x: number, y: number): void;
  titles(menu: string): Promise<string[]>;
  setWindowWidth(width: number): void;
  setWindowTitle(title: string, subtitle: string): void;
  topInset(): Promise<number>;
  adoptToolbarInsets(): Promise<string[]>;
  setToolbarLabel(commandId: string, label: string): void;
  setFilesMode(files: boolean): void;
  setSearchText(text: string): void;
  focusSearch(): void;
  postCommand(commandId: string): void;
  postSearch(text: string): void;
  firstResponder(): Promise<Record<string, unknown>>;
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
/** A toolbar button's label and hint, by its command's id. */
export function setToolbarLabel(commandId: string, label: string): void {
  TableMenu?.setToolbarLabel(commandId, label);
}

/** Which side of the sidebar the toolbar's switch shows. */
export function setToolbarFilesMode(files: boolean): void {
  TableMenu?.setFilesMode(files);
}

/** The toolbar's search field's text, when the app changes it. */
export function setSearchText(text: string): void {
  TableMenu?.setSearchText(text);
}

/** Put the cursor in the toolbar's search field. */
export function focusSearch(): void {
  TableMenu?.focusSearch();
}

/** Call `then` with the search field's text as it's typed. Returns the unsubscribe. */
export function onSearch(then: (text: string) => void): () => void {
  const sub = events?.addListener("search", (e: { text: string }) => then(e.text));
  return () => sub?.remove();
}

/**
 * The system's menu of `items`; resolves with the id chosen, or null when
 * it's dismissed. With `at` (a point in the content, as React measures)
 * the ticked item opens over it, as a pop-up button's does; without, the
 * menu opens at the pointer, as a context menu does.
 */
export function popUpMenu(items: PopUpItem[], at: { x: number; y: number } | null = null): Promise<string | null> {
  return TableMenu?.popUp(items, at) ?? Promise.resolve(null);
}

/**
 * A right-click (or Control-click) in the content. `target` is the `id`
 * of the nearest element up from the one clicked whose id starts "menu-",
 * or "" when there's none.
 */
export function onContextMenu(then: (target: string) => void): () => void {
  const sub = events?.addListener("contextMenu", (e: { target: string }) => then(e.target));
  return () => sub?.remove();
}

/**
 * Development only: the last pop-up menu's titles; choosing from the next
 * one by title, `seconds` after it opens ("" dismisses it), set before it
 * opens since nothing reaches the app while a menu is open; a right-click
 * at a point.
 */
export function popUpTitles(): Promise<string[]> {
  return TableMenu?.popUpTitles() ?? Promise.resolve([]);
}
export function popUpChoose(title: string, seconds = 1): void {
  TableMenu?.popUpChoose(title, seconds);
}
export function postRightClick(x: number, y: number): void {
  TableMenu?.postRightClick(x, y);
}

/** Development only: what has the keyboard. */
export function firstResponder(): Promise<Record<string, unknown>> {
  return TableMenu?.firstResponder() ?? Promise.resolve({});
}

/** Development only: text typed in the toolbar's search field. */
export function postSearch(text: string): void {
  TableMenu?.postSearch(text);
}

/** Development only: a toolbar button pressed, by its command's id. */
export function postCommand(commandId: string): void {
  TableMenu?.postCommand(commandId);
}

/** Let the system inset the view's scroll under the toolbar and soften what scrolls behind it. */
export function adoptToolbarInsets(): Promise<string[]> {
  return TableMenu?.adoptToolbarInsets() ?? Promise.resolve([]);
}

/** How far the toolbar comes down over the content, in points. */
export function toolbarInset(): Promise<number> {
  return TableMenu?.topInset() ?? Promise.resolve(0);
}

/** The window's title, and the line under it: the view on screen and where it lives. */
export function setWindowTitle(title: string, subtitle: string): void {
  TableMenu?.setWindowTitle(title, subtitle);
}

export function setWindowWidth(width: number): void {
  TableMenu?.setWindowWidth(width);
}

/** Development: click the button titled so in the alert on screen; resolves whether there was one. */
export function pressAlertButton(title: string): Promise<boolean> {
  return TableMenu?.pressAlertButton(title) ?? Promise.resolve(false);
}
