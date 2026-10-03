"""Grid-shaped impossible figures in the Workspace glyph's style.
Bars are boxes; each is split where it crosses another so every crossing
can choose which bar is drawn on top, independently of depth. Faces merge
only within one bar, so crossings keep their outlines."""
import math, sys
from shapely.geometry import Polygon
from shapely.ops import unary_union
import impossible as I
GROUP = {}  # bar index -> merge group, so a frame made of several bars draws as one piece

def render(items, stroke_frac=0.0169, size=1024, glyph_frac=0.62):
    """items: (box, bar_id) in draw order, back to front."""
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
        gid = GROUP.get(gid, gid)
        for plane, pts in I.faces(box):
            if hidden(box, plane):
                continue
            drawn.append(((gid, plane), Polygon([I.proj(p) for p in pts])))
    visible = {}
    for i, (key, poly) in enumerate(drawn):
        later = unary_union([p for _, p in drawn[i + 1:]]) if i + 1 < len(drawn) else None
        v = poly.difference(later) if later is not None else poly
        if not v.is_empty:
            visible.setdefault(key, []).append(v)
    regions = [unary_union(v).buffer(1e-3, join_style=2).buffer(-2e-3, join_style=2).buffer(1e-3, join_style=2).simplify(2e-3) for v in visible.values()]
    regions = [r for r in regions if not r.is_empty and r.area > 1e-3]
    allg = unary_union(regions)
    minx, miny, maxx, maxy = allg.bounds
    w, h = maxx - minx, maxy - miny
    scale = size * glyph_frac / max(w, h)
    ox = size / 2 - (minx + w / 2) * scale
    oy = size / 2 - (miny + h / 2) * scale
    sw = stroke_frac * size * glyph_frac
    def path(g):
        polys = [g] if isinstance(g, Polygon) else list(getattr(g, "geoms", []))
        d = ""
        for p in polys:
            if not isinstance(p, Polygon) or p.area < 1e-6:
                continue
            for ring in [p.exterior, *p.interiors]:
                d += "M" + " L".join(f"{x * scale + ox:.2f},{y * scale + oy:.2f}" for x, y in ring.coords) + " Z "
        return d
    body = "".join(f'<path d="{path(r)}" fill="#fff" stroke="#000" stroke-width="{sw:.2f}" stroke-linejoin="miter" stroke-miterlimit="10" fill-rule="evenodd"/>' for r in regions)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}"><rect width="{size}" height="{size}" fill="#fff"/>{body}</svg>'

def split(box, axis, cuts):
    i = "xyz".index(axis)
    lo, hi = box[i]
    pts = sorted({lo, hi, *[c for c in cuts if lo < c < hi]})
    out = []
    for a, b in zip(pts, pts[1:]):
        nb = list(box); nb[i] = (a, b); out.append(tuple(nb))
    return out

def weave(bars, over):
    """bars: list of (box, axis). over(i, j) -> True if bar i is on top where
    bars i and j cross. Returns draw-ordered items."""
    segs = []  # (box, bar index)
    for k, (box, axis) in enumerate(bars):
        i = "xyz".index(axis)
        cuts = []
        for m, (ob, oa) in enumerate(bars):
            if m != k and oa != axis:
                cuts += [ob[i][0], ob[i][1]]
        segs += [(s, k) for s in split(box, axis, cuts)]
    def overlaps(a, b):
        return all(a[j][0] < b[j][1] and b[j][0] < a[j][1] for j in range(3))
    # A segment crossing others goes after the ones it is over.
    n = len(segs)
    after = {s: set() for s in range(n)}
    for p in range(n):
        for q in range(n):
            if segs[p][1] != segs[q][1] and overlaps(segs[p][0], segs[q][0]) and over(segs[p][1], segs[q][1], segs[p][0]):
                after[p].add(q)
    order, done = [], set()
    def visit(p, stack=()):
        if p in done: return
        for q in after[p]:
            if q not in stack: visit(q, stack + (p,))
        done.add(p); order.append(p)
    # Plain segments first, so crossings sit on top of their neighbours.
    crossing = {p for p in range(n) if after[p] or any(p in after[q] for q in range(n))}
    for p in range(n):
        if p not in crossing: visit(p)
    for p in range(n):
        visit(p)
    return [segs[p] for p in order]

def grid(nx, ny, L, w=1, gap=2, z=(0, 1), pattern=None):
    """nx bars along x and ny along y, all at the same height."""
    step = w + gap
    off = (L - ((max(nx, ny) - 1) * step + w)) / 2
    bars = []
    for i in range(nx):
        y0 = off + i * step
        bars.append((((0, L), (y0, y0 + w), z), "x"))
    for j in range(ny):
        x0 = off + j * step
        bars.append((((x0, x0 + w), (0, L), z), "y"))
    return bars

def checker(nx):
    # bar i is over bar j at their crossing when (i + j) is even (x bars first)
    def over(i, j, seg):
        if i < nx:  # x bar i, y bar j - nx
            return (i + (j - nx)) % 2 == 0
        return (j + (i - nx)) % 2 == 1
    return over

def plane_grid(nr, nc, L, w=1, gap=2, rows="z", cols="x", depth="y", t=(0, 1), Lc=None):
    """nr row bars along `rows` and nc column bars along `cols`, all in one
    layer of thickness t along `depth`. Returns (bars, over_checker)."""
    Lc = Lc if Lc is not None else L
    step = w + gap
    def place(n, span):
        off = (span - ((n - 1) * step + w)) / 2
        return [off + k * step for k in range(n)]
    ri, ci, di = ("xyz".index(rows), "xyz".index(cols), "xyz".index(depth))
    bars = []
    for c0 in place(nr, Lc):          # a row bar sits at a position across the columns axis
        b = [None] * 3; b[ri] = (0, L); b[ci] = (c0, c0 + w); b[di] = t
        bars.append((tuple(b), rows))
    for r0 in place(nc, L):
        b = [None] * 3; b[ci] = (0, Lc); b[ri] = (r0, r0 + w); b[di] = t
        bars.append((tuple(b), cols))
    def over(i, j, seg, flip=0):
        a, b = (i, j - nr) if i < nr else (j, i - nr)
        row_on_top = (a + b + flip) % 2 == 0
        return row_on_top if i < nr else not row_on_top
    return bars, over
