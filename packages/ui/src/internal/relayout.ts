/**
 * Told when the space a view is laid out in has changed for a reason the
 * system doesn't announce: a sidebar or an inspector opening, a split
 * dragged. A native host calls `notifyLayoutChanged` from the `onLayout`
 * of the view its content sits in, and what was measured once
 * (`useContainerWidth`) is measured again. The web needs none of it: it
 * observes each element's own size.
 *
 * A part of the page that knows its own width (an embed's frame) has a
 * channel of its own (`layoutChannel`, given to what's in it through
 * `LayoutChannel`): a frame that changes width tells only what's in it. Told
 * through the page, every frame's change was every table's, and a document
 * of many embeds measured each of them many times over at every step of a
 * window being resized.
 */
import { createContext } from "react";

type Listen = (listener: () => void) => () => void;

const listeners = new Set<() => void>();

export function notifyLayoutChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function onLayoutChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A channel of its own: `notify` tells only what `listen`s to it. */
export function layoutChannel(): { notify: () => void; listen: Listen } {
  const own = new Set<() => void>();
  return {
    notify: () => {
      for (const listener of [...own]) listener();
    },
    listen: (listener) => {
      own.add(listener);
      return () => {
        own.delete(listener);
      };
    },
  };
}

/** Where what's measured hears that its space changed: the page's, unless something nearer has its own. */
export const LayoutChannel = createContext<Listen>(onLayoutChanged);
