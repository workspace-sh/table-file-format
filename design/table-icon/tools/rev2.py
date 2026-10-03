import oblique as O, grids as G
base = dict(w=1.8, gap=2.2, over=2.16, depth=2.16)
# r6: depth to the right (mirror the regions left to right)
from shapely import affinity
L = 2 * base["over"] + 2 * base["w"] + base["gap"]
bars, ov = G.plane_grid(2, 2, L=L, w=base["w"], gap=base["gap"], rows="x", cols="y", depth="z", t=(0, base["depth"]))
regs = O.weave_regions(bars, ov)
open("grids/r6-depth-right.svg", "w").write(O.svg_regions([affinity.scale(r, -1, 1, origin=(0, 0)) for r in regs]))
# r7: heavier lines for small sizes
open("grids/r7-heavier.svg", "w").write(O.svg_regions(regs, line=11))
