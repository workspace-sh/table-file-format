// What changing the view on screen leaves behind, whatever changed it: the
// sidebar, Back or Forward, a relation, an address. The search was for the
// view being left, and so were its settings, so both go; choosing the view
// already on screen changes nothing. Each app applies it wherever the view
// on screen changes.

export interface Leaving {
  clearSearch: boolean;
  closeSettings: boolean;
}

export function leaving(fromKey: string, fromViewId: string, toKey: string, toViewId: string): Leaving {
  const changed = fromKey !== toKey || fromViewId !== toViewId;
  return { clearSearch: changed, closeSettings: changed };
}
