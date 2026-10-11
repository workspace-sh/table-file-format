/**
 * Told when the space a view is laid out in has changed for a reason the
 * system doesn't announce: a sidebar or an inspector opening, a split
 * dragged. A native host calls `notifyLayoutChanged` from the `onLayout`
 * of the view its content sits in, and what was measured once
 * (`useContainerWidth`) is measured again. The web needs none of it: it
 * observes each element's own size.
 */
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
