import math, oblique as O, grids as G, impossible as I, glyph

def regs(w, gap, over, depth, flip=True):
    L = 2 * over + 2 * w + gap
    bars, ov = G.plane_grid(2, 2, L=L, w=w, gap=gap, rows="x", cols="y", depth="z", t=(0, depth))
    o = (lambda i, j, s: not ov(i, j, s)) if flip else ov
    return O.weave_regions(bars, o)

def slivers(r, w):
    t = 0.25 * w
    return round(sum(x.difference(x.buffer(-t, join_style=2).buffer(t, join_style=2)).area for x in r) / (w * w), 3)

