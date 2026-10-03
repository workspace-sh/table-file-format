from persp import regs, slivers
import warnings; warnings.filterwarnings("ignore")
for ratio in (0.8, 1.0):
    hits = []
    for w in (1.5, 1.6, 1.7, 1.8):
        for gap in (2.4, 2.6, 2.8, 3.0, 3.2):
            for k in (0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 1.8):
                over, depth = k * w, 2 * ratio * w
                if slivers(regs(w, gap, over, depth), w) == 0:
                    total = 2 * over + 2 * w + gap + depth / 2
                    hits.append((round(w / total, 3), w, gap, round(over, 2), round(depth, 2), round((gap - depth / 2) / w, 2)))
    hits.sort(reverse=True)
    print("ratio", ratio); [print("  bar/total %.3f  w %.1f gap %.1f over %.2f depth %.2f  open cell %.2f w" % h) for h in hits[:8]]
