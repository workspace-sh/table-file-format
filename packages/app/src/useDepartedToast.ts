// The toast for rows an edit took out of the view (departed.ts, #598), for
// any platform to draw: what it says, when it goes, and its Undo. It goes
// a while after the last row it counted, so ticking on keeps it up.

import { useEffect, useMemo, type Dispatch } from "react";
import { departedText, type DepartedText } from "./departed.ts";
import { viewIdOf, type AppAction, type AppState } from "./appState.ts";

/** How long the toast stays after the last row it counted. */
export const DEPARTED_TOAST_MS = 3500;

export interface DepartedToast extends DepartedText {
  /** One more each time a row is counted: what to animate the count on. */
  n: number;
  /** Put every counted row back, as one step. */
  onUndo: () => void;
  /** Gone now (dismissed): its rows stay where the edits put them. */
  onDismiss: () => void;
}

/**
 * The toast to show, or null. `held` keeps it up past its time (a pointer
 * resting on it, VoiceOver reading it); it goes once let go. No app yet
 * (still loading): none.
 */
export function useDepartedToast(state: AppState | null | undefined, dispatch: Dispatch<AppAction> | undefined, held = false): DepartedToast | null {
  const departed = state?.departed ?? null;
  useEffect(() => {
    if (!departed || held || !dispatch) return;
    const t = setTimeout(() => dispatch({ type: "departedDone" }), DEPARTED_TOAST_MS);
    return () => clearTimeout(t);
  }, [departed?.n, departed?.key, held, dispatch]);
  return useMemo(() => {
    if (!departed || !state || !dispatch) return null;
    const table = state.tables[departed.key];
    const view = table?.views.find((v) => v.id === departed.viewId);
    if (!table || !view || viewIdOf(state, departed.key) !== departed.viewId) return null;
    return {
      ...departedText(departed, table, view.name),
      n: departed.n,
      onUndo: () => dispatch({ type: "putBackDeparted" }),
      onDismiss: () => dispatch({ type: "departedDone" }),
    };
  }, [departed, state?.tables, state?.viewIds, dispatch]);
}
