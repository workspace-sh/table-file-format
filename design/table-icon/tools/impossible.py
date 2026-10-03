"""Impossible figures in the Workspace glyph's style: isometric bars drawn as
black outlines on white. Boxes are drawn back to front (the order given),
each face clipped by what's drawn after it; faces in the same plane merge,
so a bar turning a corner has no seam. Faking the order makes them
impossible."""
import math, sys
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

C = math.sqrt(3) / 2

ROT = 1  # quarter turns, so lines run horizontally as in the Workspace glyph

def proj(p):
    x, y, z = p
    X, Y = (x - y) * C, (x + y) * 0.5 - z
    for _ in range(ROT):
        X, Y = -Y, X
    return (X, Y)

def faces(box):
    (x0, x1), (y0, y1), (z0, z1) = box
    return [
        (("x", x1), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
        (("y", y1), [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]),
        (("z", z1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
    ]

def render(boxes, stroke_frac=0.0169, size=1024, glyph_frac=0.62):
    drawn = []  # (plane, polygon) in draw order
    def hidden(box, plane):
        # A face against another box of the figure is inside it: not drawn.
        axis, at = plane
        i = "xyz".index(axis)
        for other in boxes:
            if other is box or other[i][0] != at:
                continue
            if all(other[j][0] <= box[j][0] and other[j][1] >= box[j][1] for j in range(3) if j != i):
                return True
        return False
    for box in boxes:
        for plane, pts in faces(box):
            if hidden(box, plane):
                continue
            drawn.append((plane, Polygon([proj(p) for p in pts])))
    visible = {}
    for i, (plane, poly) in enumerate(drawn):
        later = unary_union([p for _, p in drawn[i + 1:]]) if i + 1 < len(drawn) else None
        v = poly.difference(later) if later is not None else poly
        if not v.is_empty:
            visible.setdefault(plane, []).append(v)
    regions = [unary_union(v).buffer(1e-7, join_style=2).buffer(-1e-7, join_style=2).simplify(1e-6) for v in visible.values()]
    allg = unary_union(regions)
    minx, miny, maxx, maxy = allg.bounds
    w, h = maxx - minx, maxy - miny
    scale = size * glyph_frac / max(w, h)
    ox = size / 2 - (minx + w / 2) * scale
    oy = size / 2 - (miny + h / 2) * scale
    sw = stroke_frac * max(w, h) * scale
    def path(g):
        polys = [g] if isinstance(g, Polygon) else list(getattr(g, "geoms", []))
        d = ""
        for p in polys:
            if not isinstance(p, Polygon) or p.area < 1e-6:
                continue
            for ring in [p.exterior, *p.interiors]:
                pts = []
                for q in ring.coords:
                    if not pts or abs(q[0] - pts[-1][0]) + abs(q[1] - pts[-1][1]) > 1e-6:
                        pts.append(q)
                d += "M" + " L".join(f"{x * scale + ox:.2f},{y * scale + oy:.2f}" for x, y in pts) + " Z "
        return d
    body = "".join(
        f'<path d="{path(r)}" fill="#fff" stroke="#000" stroke-width="{sw:.2f}" stroke-linejoin="miter" stroke-miterlimit="10" fill-rule="evenodd"/>'
        for r in regions
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}"><rect width="{size}" height="{size}" fill="#fff"/>{body}</svg>'

def bar(a, b, w=1):
    """A box from corner a to corner b (inclusive extents)."""
    return tuple((min(p, q), max(p, q)) for p, q in zip(a, b))

# A. Penrose triangle: along x, then y, then up z; the end of the last bar
# projects onto the start of the first, and the start is drawn on top.
def penrose(L=5, w=1):
    b1a = ((0, w), (0, w), (0, w))
    b1b = ((w, L), (0, w), (0, w))
    b2 = ((L - w, L), (w, L), (0, w))
    b3 = ((L - w, L), (L - w, L), (w, L))
    return [b1b, b2, b3, b1a]

# B. Reutersvärd triangle: the same path in unit cubes with gaps.
def reutersvard(n=4, gap=0.18):
    s = 1 - gap
    cubes = []
    for i in range(n):
        cubes.append(((i, i + s), (0, s), (0, s)))
    for j in range(1, n):
        cubes.append(((n - 1, n - 1 + s), (j, j + s), (0, s)))
    for k in range(1, n - 1):
        cubes.append(((n - 1, n - 1 + s), (n - 1, n - 1 + s), (k, k + s)))
    first = cubes.pop(0)
    return cubes + [first]

# C. Impossible cube (Escher's): a cube frame where one back edge passes in
# front of a front edge.
def impossible_cube(L=5, w=1):
    e = []
    # bottom square (z 0..w)
    e += [((0, L), (0, w), (0, w)), ((0, L), (L - w, L), (0, w)), ((0, w), (w, L - w), (0, w)), ((L - w, L), (w, L - w), (0, w))]
    # top square (z L-w..L)
    e += [((0, L), (0, w), (L - w, L)), ((0, L), (L - w, L), (L - w, L)), ((0, w), (w, L - w), (L - w, L)), ((L - w, L), (w, L - w), (L - w, L))]
    # verticals
    v = [((0, w), (0, w), (w, L - w)), ((L - w, L), (0, w), (w, L - w)), ((0, w), (L - w, L), (w, L - w)), ((L - w, L), (L - w, L), (w, L - w))]
    order = sorted(e + v, key=lambda b: b[0][1] + b[1][1] + b[2][1])
    # the far vertical (x 0, y 0) drawn last, in front of the near top edge
    far = v[0]
    order.remove(far)
    return order + [far]

# D. Penrose triangle with chunkier bars, closer to the Workspace bars.
def penrose_thick():
    return penrose(L=4, w=1)

if __name__ == "__main__":
    import itertools
    shapes = {"a-penrose": penrose(), "b-reutersvard": reutersvard(), "c-cube": impossible_cube(L=6), "d-penrose-thick": penrose_thick()}
    if len(sys.argv) > 1:
        ROT = int(sys.argv[1])
    for name, boxes in shapes.items():
        open(f"{name}.svg", "w").write(render(boxes))
        print(name)
