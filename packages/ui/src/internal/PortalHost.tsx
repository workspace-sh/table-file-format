/**
 * Cross-platform portal host. Replaces RN's `Modal` on the native side
 * because RN-macOS's Modal implementation throws at construction
 * (`createNode` → "Exception in HostFunction"), and we'd rather have
 * one mechanism that works on iOS / Android / macOS than special-case
 * macOS.
 *
 * How it works:
 *   <PortalHost>             — mounted near the app root by each app
 *     <App />                — normal tree
 *   </PortalHost>            — children registered by <Portal/> render here
 *
 * Each `<Portal>` consumer registers a slot via React context; the
 * host renders all live slots as absolutely-positioned overlays
 * inside its own bounds. Because the host wraps the entire app, the
 * overlays escape any clipping ancestor inside `<App />`.
 *
 * Web has a real `createPortal` so `Portal.web.tsx` still uses that
 * directly; this file is the native fallback. The web variant of
 * Portal doesn't depend on PortalHost being mounted.
 *
 * Style choice: the overlay container uses `pointerEvents: "box-none"`
 * so it doesn't intercept events on its own — children opt in if they
 * need them (e.g. the body-editor modal's backdrop). The drag ghost
 * already declares `pointerEvents: "none"` for the same reason.
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { html, css } from "react-strict-dom";

interface PortalHostApi {
  add: (id: string, children: ReactNode) => void;
  remove: (id: string) => void;
}

const PortalHostContext = createContext<PortalHostApi | null>(null);

const styles = css.create({
  host: {
    display: "flex",
    flex: 1,
    // Establishes a containing block so portaled children using
    // `position: absolute` size themselves against the host bounds —
    // i.e. the whole app window — and not whatever positioned
    // ancestor sits above them in the tree.
    position: "relative",
  },
});

interface Slot {
  id: string;
  children: ReactNode;
}

export function PortalHost({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slot[]>([]);

  const add = useCallback((id: string, c: ReactNode) => {
    setSlots((prev) => {
      // Replace if the id already exists (child reference changed) —
      // keeps multiple updates within one mount cycle idempotent.
      const without = prev.filter((s) => s.id !== id);
      return [...without, { id, children: c }];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Stable context value — the inline `{ add, remove }` object was a
  // new reference each host render, which made EVERY Portal consumer
  // re-render on every host state update. That re-fired their effects,
  // which called add() again, which set state, which re-rendered...
  // useMemo with stable deps breaks the loop.
  const api = useMemo(() => ({ add, remove }), [add, remove]);

  return (
    <PortalHostContext.Provider value={api}>
      <html.div style={styles.host}>
        {children}
        {/* Slots render after the main tree so they paint on top in
            z-order. Each slot's child handles its own absolute
            positioning (drag ghost, modal backdrop, etc.); Fragment
            wrapping avoids introducing an event-catching element. */}
        {slots.map((s) => (
          <Fragment key={s.id}>{s.children}</Fragment>
        ))}
      </html.div>
    </PortalHostContext.Provider>
  );
}

/**
 * Returns the active portal host's API, or `null` if no host is
 * mounted above this component. `Portal` falls back to rendering
 * children inline in that case so a missing host degrades gracefully
 * instead of swallowing the children.
 */
export function usePortalHost(): PortalHostApi | null {
  return useContext(PortalHostContext);
}

/**
 * Render `children` into the nearest `<PortalHost>`. Subscribes via
 * an effect so the host re-renders whenever children change.
 *
 * Returns `null` from the actual tree position — all output goes
 * through the host.
 */
export function HostedPortal({ children }: { children: ReactNode }) {
  const host = usePortalHost();
  const id = useId();

  useEffect(() => {
    if (!host) return;
    host.add(id, children);
    return () => host.remove(id);
  }, [host, id, children]);

  // No host mounted: render inline so consumers still work, just
  // without the "escape clipping" property. Keeps the demo apps that
  // forget to mount PortalHost from showing nothing at all.
  if (!host) return <>{children}</>;
  return null;
}
