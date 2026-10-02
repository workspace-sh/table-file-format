// Scrolling a container while a drag holds near its edge, as Trello and
// Linear do: a card dragged to the board's edge brings the next column in.
// The speed rule is free of any DOM; `edgeScroller` (web) applies it.

/** How close to a container's edge the pointer starts it scrolling. */
export const EDGE_ZONE_PX = 56;
/** How fast it scrolls with the pointer on (or past) the edge. */
export const EDGE_MAX_SPEED = 900;

/**
 * The speed (pixels per second, negative towards the start) to scroll a
 * container spanning `start`..`end` along one axis, with the pointer at
 * `pos`: nothing outside the edge zones, rising to the maximum at the
 * edge itself and past it.
 */
export function edgeSpeed(pos: number, start: number, end: number): number {
  // A container too small for two zones gives each a quarter.
  const zone = Math.min(EDGE_ZONE_PX, Math.max(0, end - start) / 4);
  if (zone <= 0) return 0;
  if (pos < start + zone) return -EDGE_MAX_SPEED * Math.min(1, (start + zone - pos) / zone);
  if (pos > end - zone) return EDGE_MAX_SPEED * Math.min(1, (pos - (end - zone)) / zone);
  return 0;
}
