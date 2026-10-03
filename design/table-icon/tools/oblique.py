"""T1's construction: the # seen face-on (front faces true shape), depth
drawn as a short diagonal offset; visible faces are front, left and bottom.
Lines as in workspace-glyph.svg: black silhouette with faces cut out."""
import math
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import affinity
import grids as G

K = (0.5, 0.5)  # screen offset per unit of depth (x, y); y points down

def proj(p):
    x, y, z = p
    return (x - K[0] * z, y + K[1] * z)

def faces(box):
    (x0, x1), (y0, y1), (z0, z1) = box
    return [
        (("z", z0, -1), [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]),  # front
        (("x", x0, -1), [(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)]),  # left
        (("y", y1, +1), [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]),  # bottom
    ]

def regions(items):
    boxes = [b for b, _ in items]
    def hidden(box, plane):
        axis, at, side = plane
        i = "xyz".index(axis)
        for o in boxes:
            if o is box: continue
            touch = o[i][1] == at if side < 0 else o[i][0] == at
            if touch and all(o[j][0] <= box[j][0] and o[j][1] >= box[j][1] for j in range(3) if j != i):
                return True
        return False
    drawn = []
    for box, gid in items:
        for plane, pts in faces(box):
            if not hidden(box, plane):
                drawn.append(((gid, plane), Polygon([proj(p) for p in pts])))
    vis = {}
    for i, (key, poly) in enumerate(drawn):
        later = unary_union([p for _, p in drawn[i + 1:]]) if i + 1 < len(drawn) else None
        v = poly.difference(later) if later is not None else poly
        if not v.is_empty: vis.setdefault(key, []).append(v)
    return [unary_union(v) for v in vis.values()]

def polys(g):
    if isinstance(g, Polygon): return [g] if not g.is_empty else []
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon) and not p.is_empty]

def svg(items, line=8.1, span=474, canvas=623):
    regs = regions(items)
    minx, miny, maxx, maxy = unary_union(regs).bounds
    s = (span - line) / max(maxx - minx, maxy - miny)
    ox = canvas / 2 - (minx + maxx) / 2 * s; oy = canvas / 2 - (miny + maxy) / 2 * s
    regs = [affinity.affine_transform(r, [s, 0, 0, s, ox, oy]) for r in regs]
    h = line / 2
    outline = unary_union(regs).buffer(h, join_style=2, mitre_limit=10)
    holes = [q for r in regs for q in polys(r.buffer(-h, join_style=2, mitre_limit=10)) if q.area > line * line / 4]
    ring = lambda c: "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in list(c.coords)[:-1]) + " Z"
    d = []
    for p in polys(outline) + holes:
        d.append(ring(p.exterior)); d += [ring(i) for i in p.interiors]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas} {canvas}">\n<path fill="black" fill-rule="evenodd" d="\n' + "\n".join(d) + '\n"/>\n</svg>\n'

def hash_(w=1, gap=2.2, over=1, depth=0.8):
    core = 2 * w + gap
    L = core + 2 * over
    # rows run along x (horizontal), columns along y (vertical), depth z
    bars, ov = G.plane_grid(2, 2, L=L, w=w, gap=gap, rows="x", cols="y", depth="z", t=(0, depth))
    return G.weave(bars, ov)

from shapely.geometry import box as rect

def weave_regions(bars, over, pad=0.5):
    """Whole bars, rows then columns; at each crossing the bar on top is
    drawn again inside a window around that crossing (its depth spill
    included), so each crossing decides its own order."""
    drawn = []
    def add(k, b, clip=None):
        for plane, pts in faces(b):
            p = Polygon([proj(q) for q in pts])
            if clip is not None: p = p.intersection(clip)
            if not p.is_empty: drawn.append(((k, plane[0], plane[1]), p))
    for k, (b, _) in enumerate(bars):
        add(k, b)
    for i, (bi, ai) in enumerate(bars):
        for j, (bj, aj) in enumerate(bars):
            if j <= i or ai == aj: continue
            x0, x1 = max(bi[0][0], bj[0][0]), min(bi[0][1], bj[0][1])
            y0, y1 = max(bi[1][0], bj[1][0]), min(bi[1][1], bj[1][1])
            if x0 >= x1 or y0 >= y1: continue
            z = max(bi[2][1], bj[2][1])
            dx, dy = K[0] * z, K[1] * z
            W = rect(x0 - dx - pad, y0 - pad, x1 + pad, y1 + dy + pad)
            top = i if over(i, j, None) else j
            add(top, bars[top][0], W)
    vis = {}
    for n, (key, poly) in enumerate(drawn):
        later = unary_union([p for _, p in drawn[n + 1:]]) if n + 1 < len(drawn) else None
        v = poly.difference(later) if later is not None else poly
        if not v.is_empty: vis.setdefault(key, []).append(v)
    return [unary_union(v) for v in vis.values()]

def svg_regions(regs, line=8.1, span=474, canvas=623):
    minx, miny, maxx, maxy = unary_union(regs).bounds
    s = (span - line) / max(maxx - minx, maxy - miny)
    ox = canvas / 2 - (minx + maxx) / 2 * s; oy = canvas / 2 - (miny + maxy) / 2 * s
    regs = [affinity.affine_transform(r, [s, 0, 0, s, ox, oy]) for r in regs]
    h = line / 2
    outline = unary_union(regs).buffer(h, join_style=2, mitre_limit=10)
    holes = [q for r in regs for q in polys(r.buffer(-h, join_style=2, mitre_limit=10)) if q.area > line * line / 4]
    ring = lambda c: "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in list(c.coords)[:-1]) + " Z"
    d = []
    for p in polys(outline) + holes:
        d.append(ring(p.exterior)); d += [ring(i) for i in p.interiors]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas} {canvas}">\n<path fill="black" fill-rule="evenodd" d="\n' + "\n".join(d) + '\n"/>\n</svg>\n'

def hash_t1(w=1, gap=3, over=2, depth=2, flip=False):
    L = 2 * over + 2 * w + gap
    bars, ov = G.plane_grid(2, 2, L=L, w=w, gap=gap, rows="x", cols="y", depth="z", t=(0, depth))
    o = (lambda i, j, s: not ov(i, j, s)) if flip else ov
    return svg_regions(weave_regions(bars, o))
