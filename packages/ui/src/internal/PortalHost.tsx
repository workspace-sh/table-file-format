/**
 * Cross-platform portal host. Replaces RN's `Modal` on the native side
 * because RN-macOS's Modal implementation throws at construction
 * (`createNode` → "Exception in HostFunction"). Web uses the .web.tsx
 * variant which delegates to `react-dom`'s `createPortal`.
 *
 * Apps mount `<PortalHost>` near the root. Each `<Portal>` consumer
 * registers its children with the host via React context. The host
 * renders all live slots after its main tree (so they paint on top)
 * using Fragments (so no event-catching wrapper).
 *
 * Loop avoidance: the context value is memoised with stable
 * useCallback deps. Without that, every host re-render produced a
 * new `{add, remove}` object, which made every Portal consumer
 * re-render, which re-fired their effect, which set state, which
 * re-rendered the host. "Maximum update depth exceeded" — confirmed
 * during the iOS drag-ghost rapid-update path.
 */
import {
  createContext,
  Fragment,
  memo,
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
    flexDirection: "column",
    // Fill the parent without depending on the parent declaring
    // `display: flex` (RSD warns when flex:1 lacks a flex parent).
    // GestureHandlerRootView (native) has `flex: 1` but doesn't
    // declare display:flex explicitly, which RSD doesn't accept;
    // absolute-fill sidesteps that.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

interface Slot {
  id: string;
  children: ReactNode;
}

/**
 * Memoised passthrough for `<PortalHost>`'s main subtree. React doesn't
 * memoise components by default — when PortalHost re-renders for an
 * unrelated reason (a slot was added or removed), every descendant
 * re-renders too. Without this wrapper, that cascade hits any active
 * `<HostedPortal>` consumer (e.g. an open BottomSheet), whose effect
 * fires again, which calls `host.add` again, which causes another
 * PortalHost re-render — "Maximum update depth exceeded."
 *
 * Memo'ing here breaks the feedback. The host can re-render to update
 * its slot rendering without dragging the app tree along.
 */
const PortalHostChildren = memo(function PortalHostChildren({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
});

export function PortalHost({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slot[]>([]);

  const add = useCallback((id: string, c: ReactNode) => {
    setSlots((prev) => {
      const without = prev.filter((s) => s.id !== id);
      return [...without, { id, children: c }];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Stable context value (see header comment).
  const api = useMemo(() => ({ add, remove }), [add, remove]);

  return (
    <PortalHostContext.Provider value={api}>
      <html.div style={styles.host}>
        <PortalHostChildren>{children}</PortalHostChildren>
        {slots.map((s) => (
          <Fragment key={s.id}>{s.children}</Fragment>
        ))}
      </html.div>
    </PortalHostContext.Provider>
  );
}

/**
 * Returns the host API or `null` if no host is mounted above. The
 * Portal component falls back to inline rendering in that case so
 * consumers don't silently disappear when an app forgets to mount
 * the host.
 */
export function usePortalHost(): PortalHostApi | null {
  return useContext(PortalHostContext);
}

/**
 * Render `children` into the nearest `<PortalHost>`. Subscribes via
 * effect so the host re-renders whenever children change.
 *
 * Safe to put `children` in the deps array because PortalHost memoises
 * its main subtree (see `PortalHostChildren`) — the host's state-driven
 * re-renders no longer cascade down here, so the effect only fires when
 * the consumer's OWN state changes produce new children. No loop.
 */
export function HostedPortal({ children }: { children: ReactNode }) {
  const host = usePortalHost();
  const id = useId();

  useEffect(() => {
    if (!host) return;
    host.add(id, children);
    return () => host.remove(id);
  }, [host, id, children]);

  if (!host) return <>{children}</>;
  return null;
}
