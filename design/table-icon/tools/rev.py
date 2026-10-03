import oblique as O, grids as G
from search import slivers
V = {
 "r0-squattest": dict(w=1.8, gap=2.2, over=2.16, depth=2.16),
 "r1-chunkier":  dict(w=2.0, gap=2.0, over=2.4, depth=2.4),
 "r2-short-ends": dict(w=1.8, gap=2.2, over=1.8, depth=1.8),
 "r3-shallow":   dict(w=1.8, gap=2.2, over=2.16, depth=1.44),
 "r4-wide-cell": dict(w=1.8, gap=2.6, over=2.16, depth=2.16),
}
for n, kw in V.items():
    print(n, round(slivers(**kw), 3))
    open(f"grids/{n}.svg", "w").write(O.hash_t1(**kw))
open("grids/r5-mirror.svg", "w").write(O.hash_t1(flip=True, **V["r0-squattest"]))
print("r5-mirror", "same geometry, weave reversed")
