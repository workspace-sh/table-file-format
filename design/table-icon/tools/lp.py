import vox
def sig(b):
    x, y, z = b
    return (z, x, y)
def plate(l=8, W=3, T=2, sx=1, sy=1, o=(0, 0, 0)):
    ox, oy, oz = o
    def span(s, a, n):  # n cells from corner a going in direction s
        return (a, a + n) if s > 0 else (a - n + W, a + W)
    ax = (span(sx, ox, l), (oy, oy + W), (oz, oz + T))
    ay = ((ox, ox + W), span(sy, oy, l), (oz, oz + T))
    return [ax, ay]
def model(**kw):
    P0 = plate(**kw)
    return [P0, [sig(b) for b in P0], [sig(sig(b)) for b in P0]]
