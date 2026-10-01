// The Display controls: the viewer's language, default date format and
// formula syntax, one row each, as table-app's `displayChoices` lays them
// out. The web sidebar and the macOS app both show these; Linux draws the
// same rows in GTK.

import { Fragment } from "react";
import { html, css } from "react-strict-dom";
import type { DisplayChoiceRow, DisplaySettingKind } from "./DisplaySettings";
import { Select } from "./PlatformControls";

export interface DisplayControlsProps {
  rows: DisplayChoiceRow[];
  onChoose: (kind: DisplaySettingKind, value: string) => void;
}

export function DisplayControls({ rows, onChoose }: DisplayControlsProps) {
  return (
    <>
      {rows.map((row) => (
        <Fragment key={row.kind}>
          <html.div style={styles.row}>
            <html.span style={styles.name}>{row.name}</html.span>
            <Select
              label={row.label}
              value={row.value}
              options={row.options}
              onChange={(value) => onChoose(row.kind, value)}
              style={styles.select}
            />
          </html.div>
          {row.note && <html.span style={styles.note}>{row.note}</html.span>}
        </Fragment>
      ))}
    </>
  );
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingInline: 8,
    paddingBlock: 3,
  },
  name: {
    fontSize: 13,
  },
  select: {
    fontSize: 12,
    paddingInline: 6,
    paddingBlock: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    maxWidth: 140,
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  note: {
    fontSize: 11,
    marginTop: 6,
    paddingInline: 8,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
});
