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
    // `position: absolute` size themselves against the host bounds
    // (i.e. the whole app window).
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
        {children}
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
