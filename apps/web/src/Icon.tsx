// The web's icons: Lucide's (https://lucide.dev, ISC licence), drawn as
// inline SVG so the page needs no icon font or library for the few it
// uses. The native apps use the system's own instead (SF Symbols on Apple
// platforms, Material Symbols on Android); a browser can't reach those.

const PATHS = {
  // lucide: menu
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  // lucide: undo-2
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"],
  // lucide: ellipsis
  more: [],
  // lucide: x
  close: ["M18 6 6 18", "m6 6 12 12"],
  // lucide: plus
  plus: ["M5 12h14", "M12 5v14"],
  // lucide: chevron-right
  chevron: ["m9 18 6-6-6-6"],
  // lucide: folder-open
  open: ["m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"],
} as const;

export type IconName = keyof typeof PATHS;

/** A Lucide icon at `size` pixels, in the text's colour. Decorative: the button around it carries the name. */
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
      {name === "more" && (
        <>
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </>
      )}
    </svg>
  );
}
