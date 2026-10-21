"""Writes the benchmark formulas: every formula in fixtures/ (formulas.json),
and 250,000 distinct ones made from them, a quarter of a 1,000,000-row
table with a formula per row (formulas-250k.json). Seeded, so the same each
run.

    python3 edn/bench/formulas.py <out-dir>
    cargo run --release -p workspace-edn --example many -- <out-dir>/formulas-250k.json
"""
import glob, json, os, random, sys

out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
here = os.path.dirname(os.path.abspath(__file__))
base = []
def walk(o):
    if isinstance(o, dict):
        if isinstance(o.get("expr"), str): base.append(o["expr"])
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
for f in sorted(glob.glob(os.path.join(here, "../../fixtures/*.table/tables/*/schema.json"))):
    walk(json.load(open(f)))
random.seed(7)
fields = ["budget", "spend", "quarter", "amount", "probability", "value", "price", "quantity"]
many = []
for i in range(250_000):
    f = random.choice(base).replace("12", str(random.randint(1, 999)), 1).replace("0)", f"{random.randint(0, 4)})", 1)
    many.append(f"(+ {f} (* {random.choice(fields)} {i}))")
json.dump(base, open(os.path.join(out_dir, "formulas.json"), "w"))
json.dump(many, open(os.path.join(out_dir, "formulas-250k.json"), "w"))
print(f"{len(base)} formulas, {len(set(many))} distinct generated")
