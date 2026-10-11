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
