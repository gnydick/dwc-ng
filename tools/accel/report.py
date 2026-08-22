#!/usr/bin/env python3
"""Render runs/report.html (self-contained, inline SVG) from runs/dataset.csv
and the raw CSVs: spectra, current sweeps, and the single-factor ranking."""
import csv, html, os, re
import numpy as np
from accel import parse_capture, spectrum

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
C = ["#2a78d6", "#eb6834", "#1baf7a"]          # validated categorical slots 1-3
INK, MUTED, GRID = "var(--ink)", "var(--muted)", "var(--grid)"

rows = list(csv.DictReader(open(os.path.join(RUNS, "dataset.csv"))))
cruise_x = [r for r in rows if r["window"] == "cruise" and r["acc_axis"] == "x" and r["g250"]]


def g250(trial, speed=100.0):
    v = [float(r["g250"]) for r in cruise_x if r["trial"] == trial and float(r["speed"]) == speed]
    return v[0] if v else None


def spec(trial, speed, dist=100.0):
    r = next(r for r in cruise_x if r["trial"] == trial and float(r["speed"]) == speed)
    rate, _, data = parse_capture(open(os.path.join(HERE, r["csv"])).read())
    move = dist / speed
    i, j = int(0.1 * move * rate), int(min(0.9 * move, len(data) / rate - 0.05) * rate)
    return spectrum(data[i:j, 0], rate)


# ------------------------------------------------------------ svg helpers
def svg(w, h, body, title):
    return (f'<figure><svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{html.escape(title)}" '
            f'font-family="system-ui,sans-serif" font-size="12">{body}</svg></figure>')


def axes(x0, y0, x1, y1, xt, yt, xl, yl, fmt_x=str, fmt_y=str):
    s = ""
    for v, px in yt:
        s += f'<line x1="{x0}" x2="{x1}" y1="{px:.1f}" y2="{px:.1f}" stroke="{GRID}" stroke-width="1"/>'
        s += f'<text x="{x0 - 6}" y="{px + 4:.1f}" text-anchor="end" fill="{MUTED}">{fmt_y(v)}</text>'
    for v, px in xt:
        s += f'<text x="{px:.1f}" y="{y1 + 16}" text-anchor="middle" fill="{MUTED}">{fmt_x(v)}</text>'
    s += f'<line x1="{x0}" x2="{x1}" y1="{y1}" y2="{y1}" stroke="{MUTED}" stroke-width="1"/>'
    s += f'<text x="{(x0 + x1) / 2}" y="{y1 + 34}" text-anchor="middle" fill="{INK}">{xl}</text>'
    s += f'<text transform="translate(14,{(y0 + y1) / 2}) rotate(-90)" text-anchor="middle" fill="{INK}">{yl}</text>'
    return s


def line_chart(series, xlabel, ylabel, title, xmax=None, ymax=None, w=720, h=320, xfmt=str):
    x0, y0, x1, y1 = 56, 20, w - 20, h - 44
    xs = [p[0] for s in series for p in s["pts"]]
    ys = [p[1] for s in series for p in s["pts"]]
    xmin, xmax = min(xs), xmax or max(xs)
    ymax = ymax or max(ys) * 1.1
    X = lambda v: x0 + (v - xmin) / (xmax - xmin) * (x1 - x0)
    Y = lambda v: y1 - v / ymax * (y1 - y0)
    yt = [(v, Y(v)) for v in np.linspace(0, ymax, 5)]
    xt = [(v, X(v)) for v in np.linspace(xmin, xmax, 6)]
    body = axes(x0, y0, x1, y1, xt, yt, xlabel, ylabel, fmt_x=xfmt, fmt_y=lambda v: f"{v:.2g}")
    for i, s in enumerate(series):
        pts = [p for p in s["pts"] if p[0] <= xmax]
        d = " ".join(f"{'M' if k == 0 else 'L'}{X(px):.1f},{Y(py):.1f}" for k, (px, py) in enumerate(pts))
        body += f'<path d="{d}" fill="none" stroke="{C[i]}" stroke-width="2" stroke-linejoin="round"/>'
        if s.get("markers"):
            for px, py in pts:
                body += f'<circle cx="{X(px):.1f}" cy="{Y(py):.1f}" r="4" fill="{C[i]}" stroke="var(--surface)" stroke-width="2"/>'
                body += f'<text x="{X(px):.1f}" y="{Y(py) - 9:.1f}" text-anchor="middle" fill="{INK}">{py:.2f}</text>'
        lx, ly = pts[-1]
        body += f'<text x="{min(X(lx) + 6, x1 - 4):.1f}" y="{Y(ly) + 4:.1f}" fill="{INK}" font-weight="600">{html.escape(s["name"])}</text>'
    return svg(w, h, body, title)


def bar_chart(items, title, band=None, w=720, unit="g"):
    rh = 18
    h = 40 + rh * len(items) + 30
    x0, x1 = 190, w - 70
    vmax = max(v for _, v in items) * 1.05
    X = lambda v: x0 + v / vmax * (x1 - x0)
    body = ""
    if band:
        body += f'<rect x="{X(band[0]):.1f}" y="20" width="{X(band[1]) - X(band[0]):.1f}" height="{rh * len(items)}" fill="{GRID}"/>'
        body += f'<text x="{X(band[1]) + 4:.1f}" y="14" fill="{MUTED}">baseline band</text>'
    for i, (name, v) in enumerate(items):
        y = 20 + i * rh
        col = C[0] if v < (band[0] if band else 0) else MUTED
        body += f'<rect x="{x0}" y="{y + 3}" width="{X(v) - x0:.1f}" height="{rh - 6}" rx="3" fill="{col}"/>'
        body += f'<text x="{x0 - 6}" y="{y + rh - 5}" text-anchor="end" fill="{INK}">{html.escape(name)}</text>'
        body += f'<text x="{X(v) + 5:.1f}" y="{y + rh - 5}" fill="{INK}">{v:.2f}</text>'
    body += f'<line x1="{x0}" x2="{x0}" y1="20" y2="{20 + rh * len(items)}" stroke="{MUTED}"/>'
    body += f'<text x="{(x0 + x1) / 2}" y="{h - 8}" text-anchor="middle" fill="{INK}">250 Hz peak amplitude ({unit}) at 100 mm/s</text>'
    return svg(w, h, body, title)


# ------------------------------------------------------------------ charts
out = []
add = lambda title, fig, note="": out.append(f"<section><h2>{title}</h2>{fig}<p>{note}</p></section>")

# 1. spectra
ser = []
for name, trial in (("baseline 2000 mA", "baseline_r2"), ("phase + 64 µstep, 2000 mA", "C_ms64_i2000_r2"), ("1400 mA", "i1400_r2")):
    fr, sp = spec(trial, 100.0)
    m = fr <= 700
    ser.append({"name": name, "pts": list(zip(fr[m].tolist(), sp[m].tolist()))})
add("Spectrum on a 100 mm/s X move (cruise window)",
    line_chart(ser, "frequency (Hz)", "amplitude (g)", "spectra", xfmt=lambda v: f"{v:.0f}"),
    "One line at 250 Hz dominates; the settings that help lower it without moving it.")

# 2. 250 Hz vs per-motor speed (baseline X)
pts = [(s, g250("baseline", float(s))) for s in (20, 50, 100, 200)]
add("250 Hz amplitude vs speed (baseline, pure X)",
    line_chart([{"name": "baseline", "pts": pts, "markers": True}], "speed (mm/s)", "250 Hz amplitude (g)", "speed", xfmt=lambda v: f"{v:.0f}"),
    "Excited at ~100 mm/s (electrical 2nd harmonic) and ~50 mm/s (4th); quiet at 20 and 200.")

# 3. current sweeps
off = [(2000, g250("baseline_r2")), (1800, g250("i1800")), (1600, g250("i1600")), (1500, g250("i1500")), (1400, g250("i1400_r2")), (1200, g250("i1200"))]
ph = [(i, g250(f"A_k1000_i{i}")) for i in (2000, 1600, 1400, 1200)]
ph64 = [(2000, np.mean([g250("C_ms64_i2000_r2"), g250("C_ms64_i2000_r3"), g250("C_ms64_i2000")])), (1400, np.mean([g250("C_ms64_i1400"), g250("C_ms64_i1400_r2")]))]
add("250 Hz amplitude vs motor current at 100 mm/s",
    line_chart([{"name": "spreadCycle", "pts": sorted(off), "markers": True},
                {"name": "phase k1000", "pts": sorted(ph), "markers": True},
                {"name": "phase + 64 µstep", "pts": sorted(ph64), "markers": True}],
               "motor current (mA)", "250 Hz amplitude (g)", "current", xfmt=lambda v: f"{v:.0f}"),
    "Current is the steep lever in spreadCycle; phase stepping + 64 µsteps reaches the same floor at full current.")

# 4. single-factor ranking
single = {}
for r in cruise_x:
    if float(r["speed"]) != 100.0 or r["trial"].startswith(("A_", "B_", "C_", "motor", "vec", "baseline_y", "phase_k1000_i")):
        continue
    single[r["trial"]] = float(r["g250"])
base = [v for t, v in single.items() if t.startswith("baseline")]
items = sorted(((t, v) for t, v in single.items() if not t.startswith("baseline")), key=lambda x: x[1])
add("Every single-factor trial, ranked",
    bar_chart(items, "ranking", band=(min(base), max(base))),
    f"Grey band = five baseline repeats ({min(base):.2f}–{max(base):.2f} g). Blue = below the band. "
    "Everything chopper-related (F, B, Y, U, H, microstepping) sits in or near the band.")

# table view
tbl = "<table><tr><th>trial</th><th>setup</th><th>50 mm/s</th><th>100 mm/s</th></tr>"
for t in sorted({r["trial"] for r in cruise_x}):
    s = html.escape(next(r["setup"] for r in cruise_x if r["trial"] == t))
    a, b = g250(t, 50.0), g250(t, 100.0)
    tbl += f"<tr><td>{t}</td><td>{s}</td><td>{'' if a is None else f'{a:.3f}'}</td><td>{'' if b is None else f'{b:.3f}'}</td></tr>"
tbl += "</table>"

page = f"""<!doctype html><meta charset="utf-8"><title>Accel tuning 2026-08-22</title>
<style>
:root{{--surface:#fcfcfb;--ink:#1a1a19;--muted:#6b6b66;--grid:#e6e6e2}}
@media(prefers-color-scheme:dark){{:root{{--surface:#1a1a19;--ink:#fff;--muted:#c3c2b7;--grid:#33332f}}}}
body{{background:var(--surface);color:var(--ink);font:15px/1.45 system-ui,sans-serif;max-width:780px;margin:24px auto;padding:0 16px}}
h1{{font-size:22px}} h2{{font-size:16px;margin:28px 0 6px}} figure{{margin:0}} p{{color:var(--muted);margin:4px 0 0}}
table{{border-collapse:collapse;font-size:12px;margin-top:12px}} td,th{{padding:2px 8px;text-align:left;border-bottom:1px solid var(--grid)}}
details{{margin-top:24px}}
</style>
<h1>Duet 3 6HC driver tuning — accelerometer trials, 2026-08-22</h1>
<p>Tool 0 LIS3DH at 1344 Hz; 100 mm X moves; 250 Hz tracked ±5 Hz. Regenerate with <code>python tools/accel/report.py</code>.</p>
{''.join(out)}
<details><summary>All trials (table view)</summary>{tbl}</details>
"""
path = os.path.join(RUNS, "report.html")
open(path, "w", encoding="utf-8").write(page)
print(path)
