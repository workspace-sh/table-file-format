// A cell's value as GTK widgets. What it shows is decided by table-ui's
// shared `describeCell`, exactly as the web views decide it; only the
// drawing is here.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import { GtkBox, GtkButton, GtkLabel, GtkScrolledWindow } from "@gtkx/jsx/gtk";
import type { ReactNode } from "react";
import type { Field, ParsedTable } from "@workspace.sh/table-core";
import { describeCell, useDisplaySettings, type RelationLink } from "@workspace.sh/table-ui/shared";
import { AttachmentImage } from "./AttachmentImage.js";
import { pillClass, styles, useDark } from "./theme.js";

export interface CellValueProps {
  field: Field | undefined;
  value: unknown;
  relatedTables?: Record<string, ParsedTable>;
  onOpenRelation?: (address: string) => void;
  /** In a grid: the lines of text the row has room for; the rest is clipped. */
  lines?: number;
  /** Start, centre or end, as the field aligns (`effectiveAlign`). */
  xalign?: number;
}

/** Markup-safe text: GTK parses `&`, `<` and `>` in a markup label. */
function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A label that never asks for more width than its cell has.
 *
 * `maxWidthChars` of 1 makes an ellipsizing label's natural width a single
 * character, so a long value can't widen its column: the cell's own width
 * decides, and the text ends in "…" there, as it does on the web.
 */
function CellText({ text, lines, xalign = 0, cssClasses }: { text: string; lines?: number; xalign?: number; cssClasses?: string[] }) {
  const wraps = lines !== undefined && lines > 1;
  return (
    <GtkLabel
      label={text}
      xalign={xalign}
      hexpand
      ellipsize={Pango.EllipsizeMode.END}
      maxWidthChars={1}
      wrap={wraps}
      wrapMode={Pango.WrapMode.WORD_CHAR}
      lines={wraps ? lines : -1}
      cssClasses={cssClasses}
      tooltipText={text.length > 24 ? text : undefined}
    />
  );
}

/**
 * Content with a natural width of its own, clipped at the cell's edge: in a
 * scroller that never scrolls, whose external policy gives it no natural
 * width, so a row of pills can't widen its column.
 */
function Clipped({ children }: { children: ReactNode }) {
  return (
    <GtkScrolledWindow
      hexpand
      hscrollbarPolicy={Gtk.PolicyType.EXTERNAL}
      vscrollbarPolicy={Gtk.PolicyType.NEVER}
      propagateNaturalHeight
      valign={Gtk.Align.CENTER}
    >
      {children}
    </GtkScrolledWindow>
  );
}

function RelationValue({ link, onOpenRelation }: { link: RelationLink; onOpenRelation?: (address: string) => void }) {
  if (link.label === null) {
    // Dangling: no related table loaded, or the row isn't in it. Shown,
    // not hidden, so a broken link is seen.
    return (
      <GtkLabel
        label={link.id}
        cssClasses={[styles.relationBroken]}
        tooltipText={`Dangling: ${link.address}`}
        ellipsize={Pango.EllipsizeMode.END}
        maxWidthChars={1}
      />
    );
  }
  if (!onOpenRelation) return <CellText text={link.label} />;
  return (
    <GtkButton
      cssClasses={["flat", styles.relationLink]}
      tooltipText={link.address}
      onClicked={() => onOpenRelation(link.address)}
    >
      <GtkLabel label={link.label} ellipsize={Pango.EllipsizeMode.END} maxWidthChars={1} />
    </GtkButton>
  );
}

export function CellValue({ field, value, relatedTables, onOpenRelation, lines, xalign = 0 }: CellValueProps) {
  const display = useDisplaySettings();
  const dark = useDark();
  const shown = describeCell(field, value, display, relatedTables);
  switch (shown.kind) {
    case "relations":
      if (shown.links.length === 1) return <RelationValue link={shown.links[0]!} onOpenRelation={onOpenRelation} />;
      return (
        <Clipped>
          <GtkBox spacing={4}>
            {shown.links.map((link) => (
              <RelationValue key={link.id} link={link} onOpenRelation={onOpenRelation} />
            ))}
          </GtkBox>
        </Clipped>
      );
    case "error":
      return <CellText text={shown.code} xalign={xalign} cssClasses={[styles.formulaError]} />;
    case "pills":
      return (
        <Clipped>
          <GtkBox spacing={4} halign={Gtk.Align.START}>
            {shown.pills.map((pill, i) => (
              <GtkLabel
                key={`${i}\u0000${String(pill.value)}`}
                label={pill.label}
                cssClasses={[styles.pill, pillClass(pill.color, dark)]}
              />
            ))}
          </GtkBox>
        </Clipped>
      );
    case "attachment":
      // The picture beside its name, when it's an image the app can find.
      return (
        <GtkBox spacing={6} hexpand>
          <AttachmentImage fileName={shown.fileName} width={24} height={24} />
          <CellText text={shown.fileName} xalign={xalign} />
        </GtkBox>
      );
    case "link":
      // GTK opens a markup link with the desktop's handler for it: the
      // browser for a URL, the mail app for mailto:, a dialler for tel:.
      return (
        <GtkLabel
          label={`<a href="${escapeMarkup(shown.href)}">${escapeMarkup(shown.text)}</a>`}
          useMarkup
          xalign={xalign}
          hexpand
          ellipsize={Pango.EllipsizeMode.END}
          maxWidthChars={1}
        />
      );
    case "text":
      return (
        <CellText
          text={shown.text}
          // A number or date is one token: it ends in "…" on one line
          // rather than wrapping to a fragment the row clips away.
          lines={shown.oneToken ? 1 : lines}
          xalign={xalign}
          cssClasses={[...(shown.text === "—" ? [styles.empty] : []), ...(shown.oneToken ? [styles.tabular] : [])]}
        />
      );
  }
}
