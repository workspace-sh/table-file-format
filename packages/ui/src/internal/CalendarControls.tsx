/**
 * Where a platform has no control of its own for these (Android, the web):
 * a segmented row and a stepper, in the views' own look.
 */
import { css, html } from "react-strict-dom";

import type { CalendarControlsProps } from "../controlSlots";

const RANGES = [
  ["month", "Month"],
  ["week", "Week"],
  ["agenda", "Agenda"],
] as const;

export function CalendarControls({ range, onRange, canPrevious, canNext, canToday, onPrevious, onNext, onToday }: CalendarControlsProps) {
  return (
    <html.div style={styles.row}>
      <html.div style={styles.group}>
        {RANGES.map(([value, label]) => (
          <html.button key={value} aria-pressed={range === value} onClick={() => onRange(value)} style={[styles.part, range === value && styles.chosen]}>
            {label}
          </html.button>
        ))}
      </html.div>
      <html.div style={styles.group}>
        <html.button aria-label="Previous" disabled={!canPrevious} onClick={onPrevious} style={[styles.part, !canPrevious && styles.off]}>‹</html.button>
        <html.button disabled={!canToday} onClick={onToday} style={[styles.part, !canToday && styles.off]}>Today</html.button>
        <html.button aria-label="Next" disabled={!canNext} onClick={onNext} style={[styles.part, !canNext && styles.off]}>›</html.button>
      </html.div>
    </html.div>
  );
}

const styles = css.create({
  row: { display: "flex", flexDirection: "row", alignItems: "center", gap: 8 },
  group: {
    display: "flex", flexDirection: "row", alignItems: "center", padding: 2, borderRadius: 9,
    backgroundColor: { default: "#eeeef2", "@media (prefers-color-scheme: dark)": "#242428" },
  },
  part: {
    height: 28, paddingInline: 10, borderWidth: 0, borderRadius: 7, fontSize: 13, fontWeight: "500", cursor: "pointer", backgroundColor: "transparent",
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  chosen: { backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#3a3a3f" } },
  off: { opacity: 0.35, cursor: "default" },
});
