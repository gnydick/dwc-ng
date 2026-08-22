#!/usr/bin/env python3
"""Flatten every runs/<trial>/summary.json into runs/dataset.csv
(one row per trial x speed x window x accelerometer axis), with the setup
G-codes decoded into columns (current, phase, k, ustep, interp, F, B, Y, U)."""
import csv, glob, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
rows = []
for p in sorted(glob.glob(os.path.join(HERE, "runs", "*", "summary.json"))):
    j = json.load(open(p)); setup = " ; ".join(j["setup"])
    g = lambda rx, d: (re.search(rx, setup) or [None, d])[1]
    meta = dict(trial=j["trial"], axis=j["axis"], started=j["started"], setup=setup,
                current=int(g(r"M906 X(\d+)", 2000)), phase=int("M970 X1" in setup), k=int(g(r"M970\.1 X(\d+)", 1000)),
                ustep=int(g(r"M350 X(\d+)", 16)), interp=int(g(r"M350 X\d+ Y\d+ I(\d)", 1)),
                F=int(g(r"F(\d+)", 3)), B=int(g(r" B(\d)", 1)), Y=g(r"Y(\d+:-?\d+)", "5:0"), U=int(g(r"U(\d+)", 31)))
    for r in j["results"]:
        for w in r["analysis"]["windows"]:
            for ax in "xyz":
                a = w["axes"][ax]; top = a["top"][0] if a["top"] else (None, None)
                rows.append({**meta, "speed": r["speed"], "window": w["name"], "acc_axis": ax, "rms": a["rms"],
                             "peak_hz": top[0], "peak_g": top[1], "g250": a["tracked"][1] if a["tracked"] else None,
                             "csv": f"runs/{j['trial']}/{r['csv']}"})
out = os.path.join(HERE, "runs", "dataset.csv")
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print(f"{out}: {len(rows)} rows, {len({r['trial'] for r in rows})} trials")
