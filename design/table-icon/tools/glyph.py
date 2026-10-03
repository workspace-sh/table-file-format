"""Draw like workspace-glyph.svg: one black silhouette with each visible
face cut out, so lines are the gaps between faces (even width, sharp
corners, no stroke joins). Same 623 canvas and glyph size as Workspace's."""
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union
import grids as G, impossible as I

CANVAS = 623
SPAN = 474      # the Workspace glyph's width on its canvas
LINE = 8.1      # its line width

def faces_of(items):
    boxes = [b for b, _ in items]
    def hidden(box, plane):
        axis, at = plane
        i = "xyz".index(axis)
        for other in boxes:
            if other is box or other[i][0] != at:
                continue
            if all(other[j][0] <= box[j][0] and other[j][1] >= box[j][1] for j in range(3) if j != i):
                return True
        return False
    drawn = []
    for box, gid in items:
        gid = G.GROUP.get(gid, gid)
        for plane, pts in I.faces(box):
            if not hidden(box, plane):
                drawn.append(((gid, plane), Polygon([I.proj(p) for p in pts])))
    visible = {}
    for i, (key, poly) in enumerate(drawn):
        later = unary_union([p for _, p in drawn[i + 1:]]) if i + 1 < len(drawn) else None
        v = poly.difference(later) if later is not None else poly
        if not v.is_empty:
            visible.setdefault(key, []).append(v)
    return [unary_union(v) for v in visible.values()]

def polys(g):
    if isinstance(g, Polygon): return [g] if not g.is_empty else []
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon) and not p.is_empty]

def svg(items, line=LINE, span=SPAN, canvas=CANVAS):
    regions = faces_of(items)
    allg = unary_union(regions)
    minx, miny, maxx, maxy = allg.bounds
    s = (span - line) / max(maxx - minx, maxy - miny)   # outer line sits outside the faces
    ox = canvas / 2 - (minx + maxx) / 2 * s
    oy = canvas / 2 - (miny + maxy) / 2 * s
    from shapely import affinity
    T = lambda g: affinity.affine_transform(g, [s, 0, 0, s, ox, oy])
    regions = [T(r) for r in regions]
    half = line / 2
    outline = unary_union(regions).buffer(half, join_style=2, mitre_limit=10)
    holes = [h for r in regions for h in polys(r.buffer(-half, join_style=2, mitre_limit=10)) if h.area > (line * line) / 4]
    def ring(c):
        pts = list(c.coords)[:-1]
        return "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
    d = []
    for p in polys(outline):
        d.append(ring(p.exterior)); d += [ring(i) for i in p.interiors]
    for h in holes:
        d.append(ring(h.exterior)); d += [ring(i) for i in h.interiors]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas} {canvas}">\n<path fill="black" fill-rule="evenodd" d="\n' + "\n".join(d) + '\n"/>\n</svg>\n'
