#!/usr/bin/env python3
"""Writes analysis.ipynb (plain nbformat JSON; no Jupyter needed to author it).
Run `python make_notebook.py` to regenerate; `python make_notebook.py --check`
also executes every code cell headlessly to prove they run."""
import json, sys


def md(s):
    return {"cell_type": "markdown", "metadata": {}, "source": s}


def code(s):
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s}


cells = [
md("""# Duet 3 6HC driver tuning — accelerometer analysis
Data: `runs/dataset.csv` (one row per trial × speed × window × axis) and raw M956 captures in `runs/<trial>/*.csv`.
Regenerate the dataset with `python dataset.py`. Needs numpy + matplotlib only."""),
code("""import csv
import numpy as np
import matplotlib.pyplot as plt
from accel import parse_capture, spectrum          # same analysis code the runner uses

RUNS = 'runs'
rows = list(csv.DictReader(open(f'{RUNS}/dataset.csv')))
for r in rows:
    for k in ('speed','rms','peak_hz','peak_g','g250','current','k','ustep','F','B','U','phase','interp'):
        r[k] = float(r[k]) if r[k] not in ('', None) else np.nan
cruise_x = [r for r in rows if r['window']=='cruise' and r['acc_axis']=='x']
print(len(rows), 'rows,', len({r['trial'] for r in rows}), 'trials')

def g250(trial, speed=100.0):
    v = [r['g250'] for r in cruise_x if r['trial']==trial and r['speed']==speed]
    return v[0] if v else np.nan

def spec(trial, speed, dist=100.0, axis=0):
    # amplitude spectrum (g) of the cruise window of one capture
    r = next(r for r in cruise_x if r['trial']==trial and r['speed']==speed)
    rate, _, data = parse_capture(open(r['csv']).read())
    move = dist/speed
    i, j = int(0.1*move*rate), int(min(0.9*move, len(data)/rate-0.05)*rate)
    return spectrum(data[i:j, axis], rate)"""),
md("## 1. Spectrum at 100 mm/s — baseline vs the two things that worked"),
code("""plt.figure(figsize=(10,4))
for name, t in [('baseline 2000 mA','baseline_r2'), ('1400 mA','i1400_r2'), ('phase + 64 µstep','C_ms64_i2000_r2')]:
    fr, sp = spec(t, 100.0); m = fr <= 700
    plt.plot(fr[m], sp[m], lw=1.2, label=name)
plt.xlabel('Hz'); plt.ylabel('g'); plt.title('X-axis spectrum, cruise window, 100 mm/s'); plt.legend(); plt.grid(alpha=.3)"""),
md("## 2. Dominant peak vs speed (stock settings)\nThe peak follows the full-step rate (speed × 5 full steps/mm); the ~250 Hz mechanical mode amplifies it at 50 / 100 / 200 mm/s."),
code("""sw = sorted([r for r in cruise_x if r['trial'] in ('lowspeed_stock','baseline')], key=lambda r: r['speed'])
sp_, rms_, pk_, g_ = (np.array([r[k] for r in sw]) for k in ('speed','rms','peak_hz','g250'))
fig, ax = plt.subplots(1, 2, figsize=(11,3.8))
ax[0].plot(sp_, rms_, 'o-', label='cruise RMS X'); ax[0].plot(sp_, g_, 's--', label='250 Hz amplitude')
ax[0].set_xlabel('mm/s'); ax[0].set_ylabel('g'); ax[0].legend(); ax[0].grid(alpha=.3)
ax[1].plot(sp_, pk_, 'o', label='measured'); ax[1].plot(sp_, sp_*5, '-', alpha=.4, label='full-step rate = speed×5')
ax[1].set_xlabel('mm/s'); ax[1].set_ylabel('dominant peak Hz'); ax[1].legend(); ax[1].grid(alpha=.3)"""),
md("## 3. 250 Hz amplitude vs motor current at 100 mm/s"),
code("""series = {
 'spreadCycle': [(2000,'baseline_r2'),(1800,'i1800'),(1600,'i1600'),(1500,'i1500'),(1400,'i1400_r2'),(1200,'i1200')],
 'phase k1000': [(i, f'A_k1000_i{i}') for i in (2000,1600,1400,1200)],
 'phase + 64 µstep': [(2000,'C_ms64_i2000_r2'), (1400,'C_ms64_i1400_r2')],
}
plt.figure(figsize=(7,4))
for name, pts in series.items():
    xs = [p[0] for p in pts]; ys = [g250(p[1]) for p in pts]
    plt.plot(xs, ys, 'o-', label=name)
    for x, y in zip(xs, ys):
        plt.annotate(f'{y:.2f}', (x,y), textcoords='offset points', xytext=(0,6), ha='center', fontsize=8)
plt.xlabel('M906 mA'); plt.ylabel('250 Hz amplitude (g)'); plt.legend(); plt.grid(alpha=.3)"""),
md("## 4. Every single-factor trial, ranked\nGrey band = five baseline repeats. Anything inside it is noise."),
code("""single = {r['trial']: r['g250'] for r in cruise_x if r['speed']==100.0
          and not r['trial'].startswith(('A_','B_','C_','motor','vec','baseline_y','phase_k1000_i','lowspeed'))}
base = [v for t, v in single.items() if t.startswith('baseline')]
items = sorted(((t, v) for t, v in single.items() if not t.startswith('baseline')), key=lambda x: x[1])
plt.figure(figsize=(8, 0.28*len(items)+1))
plt.axvspan(min(base), max(base), color='0.85', label=f'baseline band {min(base):.2f}–{max(base):.2f}')
plt.barh([t for t, _ in items], [v for _, v in items], color=['C0' if v < min(base) else '0.5' for _, v in items])
plt.gca().invert_yaxis(); plt.xlabel('250 Hz amplitude (g) at 100 mm/s'); plt.legend(); plt.grid(axis='x', alpha=.3)"""),
md("## 5. Cross designs (phase k × current, µstep × current, hysteresis × off-time × current)"),
code("""def grid(rowvals, colvals, fmt, rowlab, collab):
    M = np.array([[g250(fmt(r, c)) for c in colvals] for r in rowvals])
    plt.imshow(M, cmap='viridis_r'); plt.colorbar(label='250 Hz g @100')
    plt.xticks(range(len(colvals)), colvals); plt.yticks(range(len(rowvals)), rowvals)
    plt.xlabel(collab); plt.ylabel(rowlab)
    for i in range(len(rowvals)):
        for j in range(len(colvals)):
            plt.text(j, i, f'{M[i,j]:.2f}', ha='center', va='center', color='w', fontsize=9)
plt.figure(figsize=(13,3.8))
plt.subplot(1,3,1); grid((2000,1600,1400,1200), (500,1000,2000), lambda i,k: f'A_k{k}_i{i}', 'mA', 'M970.1 k'); plt.title('A: phase k × current')
plt.subplot(1,3,2); grid((2000,1400), (16,32,64), lambda i,m: f'C_ms{m}_i{i}', 'mA', 'µsteps (phase k1000)'); plt.title('C: µstep × current')
plt.subplot(1,3,3); grid((1400,1600), ('1_0_f3','5_0_f3','8_5_f3','1_0_f8','5_0_f8','8_5_f8'), lambda i,y: f'B_i{i}_y{y}', 'mA', 'Y:F'); plt.title('B: hysteresis/off-time × current')
plt.tight_layout()"""),
md("""## 7. Input shaping - ringing fingerprint, predicted vs measured
From `shaping.py` (`runs/ring/<name>/`). Hard stops on X and Y; free decay fitted for frequency + damping; every RRF shaper simulated; top candidates verified on the machine."""),
code("""import json
from shaping import shaper_impulses, residual, SHAPERS, detect_stop
R = 'runs/ring/ring1'
fp = json.load(open(f'{R}/fingerprint.json')); ver = json.load(open(f'{R}/verify.json'))['results']
modes = {a: v for a, v in fp['fingerprint'].items() if v}
print({a: f"{m['f']:.1f} Hz  zeta {m['zeta']:.3f}  {m['peak_g']:.3f} g" for a, m in modes.items()})

# one decay per axis, raw + envelope
fig, ax = plt.subplots(1, 2, figsize=(12, 3.5))
for k, axis in enumerate('XY'):
    c = next(c for c in json.load(open(f'{R}/ring.json'))['captures'] if c['axis']==axis and c['dir']=='+' and c['rep']==0)
    rate, _, d = parse_capture(open(f"{R}/{c['csv']}").read()); t = np.arange(len(d))/rate
    ts = detect_stop(d[:, k], rate)
    ax[k].plot(t, d[:, k], lw=.6); ax[k].axvline(ts, color='k', ls='--', lw=.8, label=f'stop {ts:.3f}s')
    ax[k].set_xlim(ts-0.05, ts+0.3); ax[k].set_title(f'{axis} stop: ring at {modes[axis]["f"]:.1f} Hz'); ax[k].set_xlabel('s'); ax[k].set_ylabel('g'); ax[k].legend()"""),
code("""# residual-vs-frequency curves for the verified candidates, with the measured modes marked
f = np.arange(8, 90, 0.25)
plt.figure(figsize=(10, 4))
for v in ver:
    A, T = (np.array(v['A']), np.array(v['T'])) if v['shaper'] == 'custom' else shaper_impulses(v['shaper'], v['F'], v['S'])
    plt.plot(f, [100*residual(A, T, x, 0.1) for x in f], label=f"{v['shaper']} F{v['F']:g}  ({T[-1]*1000:.0f} ms)")
for a, m in modes.items():
    plt.axvline(m['f'], color='k', ls=':', lw=.8); plt.text(m['f'], 95, f' {a} {m["f"]:.0f} Hz', fontsize=8)
plt.ylim(0, 100); plt.xlabel('mode frequency (Hz)'); plt.ylabel('predicted residual %'); plt.legend(fontsize=8); plt.grid(alpha=.3)"""),
code("""# predicted vs measured residual per candidate (measured = post-shaping ring peak / unshaped ring peak)
labels = [v['code'].replace('M593 ', '') for v in ver]
x = np.arange(len(ver)); w = 0.2
plt.figure(figsize=(11, 4))
for i, (a, col) in enumerate((('X', 'C0'), ('Y', 'C1'))):
    plt.bar(x + (i-1.5)*w, [100*v['predicted'][a] for v in ver], w, color=col, alpha=.4, label=f'{a} predicted')
    plt.bar(x + (i+0.5)*w, [100*v['measured'][a] for v in ver], w, color=col, label=f'{a} measured')
plt.xticks(x, labels, rotation=15, fontsize=8); plt.ylabel('% of unshaped ringing'); plt.axhline(100, color='k', lw=.6)
plt.legend(); plt.grid(axis='y', alpha=.3); plt.title('17.5 Hz shapers measured WORSE (new 38 Hz artefact); the 52 Hz Y-only ones silence X too')"""),
md("## 8. Scratch — look at any raw capture\nChange `trial`/`speed`; `axis` 0=X 1=Y 2=Z."),
code("""trial, speed, axis = 'baseline', 100.0, 0
r = next(r for r in cruise_x if r['trial']==trial and r['speed']==speed)
rate, ov, data = parse_capture(open(r['csv']).read()); t = np.arange(len(data))/rate
fig, ax = plt.subplots(1, 2, figsize=(12,3.5))
ax[0].plot(t, data[:,axis], lw=.6); ax[0].set_xlabel('s'); ax[0].set_ylabel('g'); ax[0].set_title(f'{trial} {speed:g} mm/s raw')
fr, sp = spec(trial, speed, axis=axis); ax[1].plot(fr, sp, lw=.8); ax[1].set_xlim(0,700); ax[1].set_xlabel('Hz'); ax[1].set_title('cruise spectrum')"""),
]

nb = {"cells": cells,
      "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                   "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 5}
json.dump(nb, open("analysis.ipynb", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote analysis.ipynb")

if "--check" in sys.argv:
    import matplotlib
    matplotlib.use("Agg")
    g = {}
    for i, c in enumerate(cells):
        if c["cell_type"] == "code":
            exec(c["source"], g)
            print("cell", i, "ok")
