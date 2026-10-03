"""Regenerates the shipped glyph: three L-shaped plates (arms 8, width 5,
thickness 2) around the view axis, turned 30° so edges run horizontal and
at 60° like workspace-glyph.svg, 8.1 lines."""
import lp, vox
open("triangle/table-glyph.svg", "w").write(vox.svg(lp.model(l=8, W=5, T=2, sx=-1, sy=1, o=(2, -4, 0)), rot=30, line=8.1))
