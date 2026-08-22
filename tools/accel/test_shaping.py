#!/usr/bin/env python3
"""python test_shaping.py  — synthetic checks for shaping.py (no board needed)."""
import math, sys
import numpy as np
from shaping import fit_decay, shaper_impulses, residual, SHAPERS

rng = np.random.default_rng(1)
fails = 0


def check(cond, msg):
    global fails
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails += 1


# 1. fit recovers f within 2 %, zeta within 20 %, for a range of modes, with noise
rate = 1344
for f, z, amp in ((14, 0.05, 0.3), (38, 0.1, 0.5), (55, 0.15, 0.2), (90, 0.03, 0.4)):
    t_stop = 0.03
    t = np.arange(int(1.1 * rate)) / rate
    x = np.zeros_like(t)
    m = t >= t_stop
    tt = t[m] - t_stop
    wn = 2 * math.pi * f
    x[m] = amp * np.exp(-z * wn * tt) * np.cos(wn * math.sqrt(1 - z * z) * tt)
    x += rng.normal(0, 0.01, len(t))
    r = fit_decay(x, rate, t_stop)
    check(r["ok"] and abs(r["f"] - f) / f < 0.02, f"fit f: {f} Hz -> {r.get('f', 0):.2f}")
    check(r["ok"] and abs(r["zeta"] - z) / z < 0.2, f"fit zeta: {z} -> {r.get('zeta', 0):.3f}")

# 2. no ringing -> no fit, not a bogus number
x = rng.normal(0, 0.005, int(1.1 * rate))
r = fit_decay(x, rate, 0.03)
check(not r["ok"], f"noise only -> no fit ({r.get('reason')})")

# 3. every shaper tuned exactly to the mode leaves ~no residual; detuned by 30 % leaves a lot
for kind in SHAPERS:
    A, T = shaper_impulses(kind, 40.0, 0.1)
    check(abs(A.sum() - 1) < 1e-6 and np.all(A > 0) and np.all(np.diff(T) > 0), f"{kind}: impulses sane")
    r0 = residual(A, T, 40.0, 0.1)
    r1 = residual(A, T, 80.0 if kind == "ei3" else 60.0, 0.1)   # EI3's flat band is +-50 %
    # RRF's MZV orders its amplitudes the reverse of Klipper's; at zeta=0.1 that leaves ~16 % at exact tuning.
    check(r0 < (0.2 if kind == "mzv" else 0.06), f"{kind}: tuned residual {100 * r0:.1f}%")
    check(r1 > r0, f"{kind}: detuned worse ({100 * r1:.1f}%)")

# 4. EI3 is wider than ZVD (band tolerance ordering from the RRF table)
def band(kind):
    A, T = shaper_impulses(kind, 40.0, 0.1)
    return sum(1 for f in np.arange(20, 60, 0.5) if residual(A, T, f, 0.1) < 0.1)
check(band("ei3") > band("zvdd") > band("zvd"), f"band widths ei3 {band('ei3')} > zvdd {band('zvdd')} > zvd {band('zvd')}")

print(f"\n{fails} failures")
sys.exit(1 if fails else 0)
