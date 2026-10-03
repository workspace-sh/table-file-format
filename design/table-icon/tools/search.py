import itertools, oblique as O, grids as G
from shapely.ops import unary_union
def slivers(w, gap, over, depth):
    L = 2 * over + 2 * w + gap
    bars, ov = G.plane_grid(2, 2, L=L, w=w, gap=gap, rows="x", cols="y", depth="z", t=(0, depth))
    regs = O.weave_regions(bars, ov)
    t = 0.25 * w  # anything thinner than half a bar counts
    bad = 0
    for r in regs:
        opened = r.buffer(-t, join_style=2).buffer(t, join_style=2)
        bad += r.difference(opened).area
    return bad / (w * w)
if __name__ == "__main__":
    res = []
    for w in [1.4, 1.5, 1.6, 1.8]:
        for gap in [2.2, 2.4, 2.6, 2.8]:
            for depth in [1.2 * w, 1.4 * w, 1.6 * w, 2 * w]:
                for over in [0.8 * w, w, 1.2 * w, w + 0.5 * depth / 2 * 1, w + depth / 2]:
                    res.append((round(slivers(w, gap, over, depth), 3), w, gap, round(over, 2), round(depth, 2), round((2*over+2*w+gap)/ (w), 2)))
    res = [r for r in res if r[0] == 0]; res.sort(key=lambda r: r[5])
    for r in res[:25]: print(r)
