"""Voxel models in the Workspace line style. Pieces are lists of boxes
((x0,x1),(y0,y1),(z0,z1)) on an integer grid; the view is isometric along
(1,1,1), exact by painting unit cubes front to back."""
import math, itertools
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import affinity
import oblique as O

C, S = math.sqrt(3) / 2, 0.5
def proj(p):
    x, y, z = p
    return ((x - y) * C, (x + y) * S - z)

def cells(pieces):
    occ = {}
    for k, boxes in enumerate(pieces):
        for (x0, x1), (y0, y1), (z0, z1) in boxes:
            for c in itertools.product(range(x0, x1), range(y0, y1), range(z0, z1)):
                occ[c] = k
    return occ

def faces_of(c):
    x, y, z = c
    return [
        (0, x + 1, [(x+1, y, z), (x+1, y+1, z), (x+1, y+1, z+1), (x+1, y, z+1)], (x+1, y, z)),
        (1, y + 1, [(x, y+1, z), (x, y+1, z+1), (x+1, y+1, z+1), (x+1, y+1, z)], (x, y+1, z)),
        (2, z + 1, [(x, y, z+1), (x+1, y, z+1), (x+1, y+1, z+1), (x, y+1, z+1)], (x, y, z+1)),
    ]

def regions(pieces, R=None):
    occ = cells(pieces)
    if R is not None:
        occ = {tuple(sum(R[i][j] * c[j] for j in range(3)) for i in range(3)): k for c, k in occ.items()}
    covered = Polygon()
    vis = {}
    for c in sorted(occ, key=lambda c: -sum(c)):
        k = occ[c]
        for axis, plane, pts, nb in faces_of(c):
            if nb in occ: continue
            p = Polygon([proj(q) for q in pts])
            v = p.difference(covered)
            if not v.is_empty:
                vis.setdefault((k, axis, plane), []).append(v)
        covered = covered.union(unary_union([Polygon([proj(q) for q in f[2]]) for f in faces_of(c)]))
    from shapely import set_precision
    return [set_precision(unary_union(v), 1e-6).simplify(1e-6) for v in vis.values()]

def svg(pieces, R=None, rot=0, line=11.5):
    rs = regions(pieces, R)
    if rot: rs = [affinity.rotate(r, rot, origin=(0, 0)) for r in rs]
    return O.svg_regions(rs, line=line)

def rotations():
    out = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            M = [[signs[i] if j == perm[i] else 0 for j in range(3)] for i in range(3)]
            d = (M[0][0]*(M[1][1]*M[2][2]-M[1][2]*M[2][1]) - M[0][1]*(M[1][0]*M[2][2]-M[1][2]*M[2][0]) + M[0][2]*(M[1][0]*M[2][1]-M[1][1]*M[2][0]))
            if d == 1: out.append(M)
    return out
