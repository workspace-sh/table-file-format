/**
 * Native default — Metro resolves to this on iOS / Android / macOS.
 * Vite picks `BottomSheet.web.tsx` for web.
 *
 * Slide-up sheet anchored to the bottom of the screen, portaled via
 * the PortalHost so it floats above all other content (drag ghosts,
 * popovers, etc.). Uses RN's built-in Animated — no Reanimated dep.
 *
 * Behaviour:
 *   - Tap backdrop → onDismiss
 *   - Slide-up on mount, slide-down + unmount on dismiss
 *   - Safe-area-bottom inset (hardcoded 24pt — fine for the spike;
 *     once a sync feature needs the bottom edge we'll switch to
 *     react-native-safe-area-context's `useSafeAreaInsets`)
 *
 * Backdrop dismiss can be disabled with `dismissOnBackdrop={false}`
 * for cases where the sheet must be confirmed (rare; defaults true).
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { html, css } from "react-strict-dom";
import { Portal } from "./Portal";

const SLIDE_MS = 220;
const BACKDROP_ALPHA = 0.5;
const BOTTOM_INSET = 24;

export interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Optional title rendered in a header bar with a close affordance. */
  title?: string;
  /** Tap-on-backdrop closes the sheet. Default true. */
  dismissOnBackdrop?: boolean;
  children?: ReactNode;
}

const sheetStyles = css.create({
  surface: {
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
  },
  header: {
    paddingInline: 16,
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    flexDirection: "row",
    alignItems: "center",
    display: "flex",
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  close: {
    paddingInline: 8,
    paddingBlock: 4,
    fontSize: 13,
    color: {
      default: "#3478f6",
      "@media (prefers-color-scheme: dark)": "#0a84ff",
    },
  },
  body: {
    paddingInline: 16,
    paddingBlock: 16,
  },
});

export function BottomSheet({
  visible,
  onDismiss,
  title,
  dismissOnBackdrop = true,
  children,
}: BottomSheetProps) {
  // Reflect prop into mount state so we can animate out before unmount.
  const screenH = Dimensions.get("window").height;
  const slide = useRef(new Animated.Value(visible ? 0 : screenH)).current;
  const backdrop = useRef(
    new Animated.Value(visible ? BACKDROP_ALPHA : 0),
  ).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 0 : screenH,
        duration: SLIDE_MS,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: visible ? BACKDROP_ALPHA : 0,
        duration: SLIDE_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, screenH, slide, backdrop]);

  // Don't render anything when fully closed — keeps the portal slot
  // empty so it doesn't intercept events.
  if (!visible) return null;

  return (
    <Portal>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Backdrop — tap to dismiss. Positioned absolute, fades in. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "#000", opacity: backdrop },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissOnBackdrop ? onDismiss : undefined}
          />
        </Animated.View>
        {/* Sheet — slides up from below. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: "85%",
              backgroundColor: "transparent",
              transform: [{ translateY: slide }],
              paddingBottom: BOTTOM_INSET,
            },
          ]}
        >
          {/* Inner RSD-styled container — keeps the sheet's surface
              styling within our normal stylex system. The Animated.View
              wrapper is layout-only. */}
          <html.div style={sheetStyles.surface}>
            {title && (
              <html.div style={sheetStyles.header}>
                <html.span style={sheetStyles.title}>{title}</html.span>
                <html.button onClick={onDismiss} style={sheetStyles.close}>
                  Done
                </html.button>
              </html.div>
            )}
            <html.div style={sheetStyles.body}>{children}</html.div>
          </html.div>
        </Animated.View>
      </View>
    </Portal>
  );
}
