"""The reference triangle, face by face on the isometric lattice
(e1 = horizontal, e2 = 60° down-right), as read from the reference crop."""
import math, sys
from shapely.geometry import Polygon
from shapely import affinity
import oblique as O
F = {
 "T1": [(1,-1),(4,-1),(3,0),(0,0)], "T2": [(4,-1),(4,1),(3,2),(3,0)],
 "T3": [(0,0),(3,0),(3,2),(2,2),(2,1),(1,1),(0,2)],
 "L1": [(1,1),(2,1),(0,3),(-1,3)], "L2": [(-1,3),(0,3),(0,6),(-1,6)],
 "L3": [(2,1),(2,2),(1,3),(1,4),(2,4),(0,6),(0,3)],
 "R1": [(4,0),(6,0),(3,3),(1,3),(2,2),(3,2),(4,1)], "R2": [(6,0),(6,1),(3,4),(3,3)],
 "R3": [(1,3),(3,3),(3,4),(1,4)],
}
def xy(a, b): return (a + b / 2, b * math.sqrt(3) / 2)
def regions(rot=0):
    rs = [Polygon([xy(*p) for p in f]) for f in F.values()]
    return [affinity.rotate(r, rot, origin=(0, 0)) for r in rs]
if __name__ == "__main__":
    from shapely.ops import unary_union
    rs = regions()
    tot = sum(r.area for r in rs); u = unary_union(rs).area
    print("valid", all(r.is_valid for r in rs), "overlap", round(tot - u, 6))
    for rot in (0, -60):
        open(f"{sys.argv[1]}/ref2_{abs(rot)}.svg", "w").write(O.svg_regions(regions(rot), line=8.1))
