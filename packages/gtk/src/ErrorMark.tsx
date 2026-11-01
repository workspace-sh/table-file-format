// A failed formula's mark (#685): its kind's Lucide icon, the web's own
// paths, drawn by GTK's SVG paintable in GTK's symbolic icon format, so it
// takes the label's colour (the theme's error red) as an icon does.

import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkImage } from "@gtkx/jsx/gtk";
import { ERROR_MARKS, type FormulaErrorGroup } from "@workspace.sh/table-ui/shared";

const made = new Map<FormulaErrorGroup, Gtk.Svg>();

/** The kind's icon, made once: each path stroked in the foreground colour, as GTK's symbolic format writes it. */
function markOf(group: FormulaErrorGroup): Gtk.Svg {
  let svg = made.get(group);
  if (!svg) {
    const paths = ERROR_MARKS[group].paths.map(
      (d) => `<path d="${d}" class="transparent-fill foreground-stroke" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    const text = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${paths.join("")}</svg>`;
    svg = Gtk.Svg.newFromBytes(GLib.Bytes.new(new TextEncoder().encode(text)));
    made.set(group, svg);
  }
  return svg;
}

export function ErrorMark({ group, cssClasses }: { group: FormulaErrorGroup; cssClasses?: string[] }) {
  return <GtkImage paintable={markOf(group)} pixelSize={14} cssClasses={cssClasses} />;
}
