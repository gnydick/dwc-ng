#!/usr/bin/env python3
"""Input-shaping analysis for RRF 3.6 (spec: docs/superpowers/specs/2026-08-22-input-shaping-analysis-design.md).

  ring    hard stops on X and Y (both directions, repeated), capture the free decay
  fit     fit ringing frequency + damping per axis from the decays -> fingerprint.json
  rank    simulate every RRF shaper over F/S against both axes' fingerprints -> ranking.json
  verify  apply top-N candidates via M593 on the machine, re-measure, compare -> verify.json
  all     ring -> fit -> rank -> verify

Local tooling only. Needs numpy (matplotlib only for the notebook).
"""
import argparse, json, math, os, sys, time, urllib.request
import numpy as np
from accel import Board, DEFAULT_TARGET, parse_capture, spectrum, ACCEL_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
RING_DIR = os.path.join(HERE, "runs", "ring")

# Hard motion envelope (user/tool coordinates), set by Gabe 2026-08-22. Not a default: a refusal.
ENVELOPE = {"X": (10.0, 320.0), "Y": (20.0, 260.0)}

SHAPERS = ("zvd", "zvdd", "zvddd", "mzv", "ei2", "ei3")


# =============================================================== shaper model
def shaper_impulses(kind, f, zeta):
    """Impulse amplitudes (sum 1) and times (s) as RRF 3.6 builds them (AxisShaper.cpp, reference only)."""
    s = math.sqrt(1.0 - zeta * zeta)
    td = 1.0 / (f * s)                      # damped period
    k = math.exp(-zeta * math.pi / s)
    if kind == "zvd":
        j = (1 + k) ** 2; A = [1 / j, 2 * k / j]; T = [0, td / 2, td]
    elif kind == "zvdd":
        j = (1 + k) ** 3; A = [1 / j, 3 * k / j, 3 * k * k / j]; T = [0, td / 2, td, 1.5 * td]
    elif kind == "zvddd":
        j = (1 + k) ** 4; A = [1 / j, 4 * k / j, 6 * k * k / j, 4 * k ** 3 / j]; T = [0, td / 2, td, 1.5 * td, 2 * td]
    elif kind == "mzv":
        km = math.exp(-zeta * 0.75 * math.pi / s)
        a1 = 1 - 0.5 * math.sqrt(2); a2 = (math.sqrt(2) - 1) * km; a3 = a1 * km * km
        tot = a1 + a2 + a3; A = [a3 / tot, a2 / tot]; T = [0, 3 * td / 8, 3 * td / 4]
    elif kind == "ei2":
        z2, z3 = zeta ** 2, zeta ** 3
        A = [0.16054 + 0.76699 * zeta + 2.26560 * z2 - 1.22750 * z3,
             0.33911 + 0.45081 * zeta - 2.58080 * z2 + 1.73650 * z3,
             0.34089 - 0.61533 * zeta - 0.68765 * z2 + 0.42261 * z3]
        T = [0, (0.49890 + 0.16270 * zeta - 0.54262 * z2 + 6.16180 * z3) * td,
             (0.99748 + 0.18382 * zeta - 1.58270 * z2 + 8.17120 * z3) * td,
             (1.49920 - 0.09297 * zeta - 0.28338 * z2 + 1.85710 * z3) * td]
    elif kind == "ei3":
        z2, z3 = zeta ** 2, zeta ** 3
        A = [0.11275 + 0.76632 * zeta + 3.29160 * z2 - 1.44380 * z3,
             0.23698 + 0.61164 * zeta - 2.57850 * z2 + 4.85220 * z3,
             0.30008 - 0.19062 * zeta - 2.14560 * z2 + 0.13744 * z3,
             0.23775 - 0.73297 * zeta + 0.46885 * z2 - 2.08650 * z3]
        T = [0, (0.49974 + 0.23834 * zeta + 0.44559 * z2 + 12.4720 * z3) * td,
             (0.99849 + 0.29808 * zeta - 2.36460 * z2 + 23.3990 * z3) * td,
             (1.49870 + 0.10306 * zeta - 2.01390 * z2 + 17.0320 * z3) * td,
             (1.99960 - 0.28231 * zeta + 0.61536 * z2 + 5.40450 * z3) * td]
    else:
        raise ValueError(kind)
    A = list(A) + [1.0 - sum(A)]            # RRF: last amplitude is the remainder
    return np.array(A), np.array(T)


def convolve_shapers(A1, T1, A2, T2):
    """Two impulse trains applied in series = one train with every pairwise (amplitude product, delay sum)."""
    acc = {}
    for a1, t1 in zip(A1, T1):
        for a2, t2 in zip(A2, T2):
            t = round(t1 + t2, 9); acc[t] = acc.get(t, 0.0) + a1 * a2
    T = np.array(sorted(acc)); A = np.array([acc[t] for t in T])
    return A / A.sum(), T


def zv_impulses(f, zeta):
    s = math.sqrt(1 - zeta * zeta); k = math.exp(-zeta * math.pi / s)
    return np.array([1 / (1 + k), k / (1 + k)]), np.array([0.0, 0.5 / (f * s)])


def custom_two_mode(m1, m2):
    """ZV(mode1) convolved with ZV(mode2): 4 impulses nulling both. Returns (A, T, M593 line)."""
    A, T = convolve_shapers(*zv_impulses(m1["f"], m1["zeta"]), *zv_impulses(m2["f"], m2["zeta"]))
    H = ":".join(f"{a:.4f}" for a in A[:-1]); Tt = ":".join(f"{t:.5f}" for t in T[1:])
    return A, T, f'M593 P"custom" H{H} T{Tt}'


def residual(A, T, f_m, zeta_m):
    """Residual vibration fraction (0..1) of an impulse train against a mode (f_m, zeta_m)."""
    wn = 2 * math.pi * f_m
    wd = wn * math.sqrt(1 - zeta_m ** 2)
    e = np.exp(zeta_m * wn * T)
    c = np.sum(A * e * np.cos(wd * T)); s = np.sum(A * e * np.sin(wd * T))
    return float(math.exp(-zeta_m * wn * T[-1]) * math.hypot(c, s))


# ================================================================= fitting
def detect_stop(move_axis, rate, thresh_g=0.25, win_s=0.012):
    """End of the last acceleration pulse on the move axis = the stop. Returns seconds, or None.
    (M956 A2 on RRF 3.6.3 delivered the whole move, so the trigger time cannot be trusted.)"""
    k = max(1, int(win_s * rate))
    lp = np.convolve(move_axis - np.median(move_axis), np.ones(k) / k, mode="same")
    hot = np.abs(lp) > thresh_g
    if not hot.any():
        return None
    last = int(np.nonzero(hot)[0][-1])
    return (last + k // 2) / rate


def fit_decay(data, rate, t_stop, fmax=150.0, floor_g=0.02, window=0.6):
    """Fit ringing (f, zeta, peak g) from the free decay after t_stop. data: (n,) g samples."""
    i0 = int((t_stop + 0.01) * rate); i1 = min(len(data), i0 + int(window * rate))
    seg = data[i0:i1]
    if len(seg) < int(0.15 * rate):
        return {"ok": False, "reason": "post-stop window too short"}
    seg = seg - seg.mean()
    # "is there ringing?" is a time-domain question (fast decays average out in a spectrum)
    tpk = float(np.abs(seg[: max(1, int(0.1 * rate))]).max())
    if tpk < floor_g:
        return {"ok": False, "reason": f"post-stop peak {tpk:.3f} g below {floor_g} g", "peak_g": tpk}
    # frequency from a zero-padded spectrum (8x -> ~0.2 Hz bins). Rectangular window: the
    # burst sits at the START of the window, a Hann taper would erase it.
    nfft = 1 << int(math.ceil(math.log2(len(seg) * 8)))
    sp = np.abs(np.fft.rfft(seg, nfft)); fr = np.fft.rfftfreq(nfft, 1 / rate)
    m = (fr >= 5) & (fr <= fmax)
    f0 = float(fr[m][np.argmax(sp[m])])
    # band-pass +-25 % around f0 via FFT mask, analytic signal -> envelope
    X = np.fft.rfft(seg); F = np.fft.rfftfreq(len(seg), 1 / rate)
    X[(F < 0.75 * f0) | (F > 1.25 * f0)] = 0
    n = len(seg); Xfull = np.zeros(n, dtype=complex)
    Xfull[: len(X)] = X * 2; Xfull[0] = X[0]
    if n % 2 == 0: Xfull[n // 2] = X[-1]
    env = np.abs(np.fft.ifft(Xfull))
    t = np.arange(n) / rate
    ipk = int(np.argmax(env[: max(1, int(0.1 * rate))]))
    lvl = env[ipk]
    # fit ln(env) from peak until it falls to 15 % of peak (or the window ends)
    below = np.nonzero(env[ipk:] < 0.15 * lvl)[0]
    iend = ipk + (int(below[0]) if len(below) else len(env) - ipk)
    if iend - ipk < int(2 * rate / f0):       # need at least 2 cycles
        return {"ok": False, "reason": "decay too short to fit", "f": f0}
    sl, _ = np.polyfit(t[ipk:iend], np.log(env[ipk:iend] + 1e-9), 1)
    zeta = -sl / (2 * math.pi * f0)
    if not (0.005 <= zeta <= 0.5):
        return {"ok": False, "reason": f"damping {zeta:.3f} outside 0.005..0.5", "f": f0}
    # secondary peaks (local maxima) for the report
    mm = np.nonzero(m)[0]; sub = sp[mm]; lm = np.nonzero((sub[1:-1] > sub[:-2]) & (sub[1:-1] >= sub[2:]))[0] + 1
    top = sorted(((float(fr[mm[i]]), float(sub[i] / sub.max())) for i in lm), key=lambda p: -p[1])[:4]
    return {"ok": True, "f": f0, "zeta": float(zeta), "peak_g": float(lvl), "cycles_fit": float((iend - ipk) * f0 / rate), "top": top}


# ================================================================= board ops
def om(board, key):
    with urllib.request.urlopen(f"{board.base}/machine/model?key={key}&flags=d3", timeout=10) as r:
        j = json.load(r)
    for part in key.split("."):
        j = j[part]
    return j


def guard(board, accel):
    st = board.status()
    if st != "idle":
        sys.exit(f"status '{st}', refusing to move")
    ax = board.axes()
    if not (ax["X"][1] and ax["Y"][1]):
        sys.exit("X/Y not homed, refusing to move")
    probe = board.code(f"M955 P{accel}")
    if "samples at" not in probe:
        sys.exit(f"no accelerometer at P{accel}: {probe}")
    return ax


def check_envelope(x, y):
    for a, v in (("X", x), ("Y", y)):
        lo, hi = ENVELOPE[a]
        if not (lo <= v <= hi):
            sys.exit(f"refusing: {a}={v} outside envelope {lo}..{hi}")


def do_ring(board, accel, name, x0, y0, dist, speed, repeats, samples, log=print):
    """Hard stops: for axis in X,Y and direction +,-: move `dist` at `speed`, capture from decel (A2)."""
    guard(board, accel)
    for x, y in ((x0, y0), (x0 + dist, y0), (x0, y0 + dist)):
        check_envelope(x, y)
    accel_mm = float(om(board, "move.travelAcceleration"))
    outdir = os.path.join(RING_DIR, name); os.makedirs(outdir, exist_ok=True)
    caps = []
    board.code("G90"); board.code(f"G1 X{x0} Y{y0} F6000"); board.code("M400")
    for axis in ("X", "Y"):
        for direction, (start, end) in (("+", (0, dist)), ("-", (dist, 0))):
            for rep in range(repeats):
                fname = f"{name}_{axis}{'p' if direction == '+' else 'm'}{rep}.csv"
                here = lambda d: f"X{x0 + d} Y{y0}" if axis == "X" else f"X{x0} Y{y0 + d}"
                board.code(f"G1 {here(start)} F6000"); board.code("M400"); board.code("G4 P300")
                board.code(f'M956 P{accel} S{samples} A2 F"{fname}"')
                board.code(f"G1 {here(end)} F{speed * 60:g}"); board.code("M400"); board.code("G4 P800")
                text = board.read(f"{ACCEL_DIR}/{fname}")
                if text is None:
                    log(f"  {fname}: missing"); continue
                open(os.path.join(outdir, fname), "w", newline="").write(text)
                rate, ov, _ = parse_capture(text)
                caps.append({"axis": axis, "dir": direction, "rep": rep, "csv": fname, "rate": rate, "overflows": ov})
                log(f"  {fname}: {rate} Hz{', OVERFLOWS ' + str(ov) if ov else ''}")
    board.code(f"G1 X{x0} Y{y0} F6000"); board.code("M400")
    meta = {"name": name, "x0": x0, "y0": y0, "dist": dist, "speed": speed, "accel": accel_mm,
            "t_stop": speed / accel_mm, "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "captures": caps}
    json.dump(meta, open(os.path.join(outdir, "ring.json"), "w"), indent=2)
    return meta


def do_fit(name, log=print):
    outdir = os.path.join(RING_DIR, name)
    meta = json.load(open(os.path.join(outdir, "ring.json")))
    per = []
    for c in meta["captures"]:
        if c["overflows"]:
            continue
        rate, _, data = parse_capture(open(os.path.join(outdir, c["csv"])).read())
        col = 0 if c["axis"] == "X" else 1
        t_stop = detect_stop(data[:, col], rate)
        if t_stop is None or t_stop > len(data) / rate - 0.2:
            per.append({"ok": False, "reason": "could not locate the stop in the capture", "axis": c["axis"], "dir": c["dir"], "rep": c["rep"]})
            log(f"  {c['axis']}{c['dir']}{c['rep']}: no fit: stop not found"); continue
        r = fit_decay(data[:, col], rate, t_stop)
        r["t_stop"] = t_stop
        r.update(axis=c["axis"], dir=c["dir"], rep=c["rep"])
        per.append(r)
        log(f"  {c['axis']}{c['dir']}{c['rep']}: stop@{t_stop:.3f}s " + (f"f={r['f']:.1f} Hz  zeta={r['zeta']:.3f}  peak={r['peak_g']:.3f} g ({r['cycles_fit']:.1f} cycles)" if r["ok"] else f"no fit: {r['reason']}"))
    fp = {}
    for axis in ("X", "Y"):
        ok = [r for r in per if r["axis"] == axis and r["ok"]]
        if ok:
            fp[axis] = {"f": float(np.median([r["f"] for r in ok])), "zeta": float(np.median([r["zeta"] for r in ok])),
                        "peak_g": float(np.median([r["peak_g"] for r in ok])), "n": len(ok),
                        "f_spread": float(np.ptp([r["f"] for r in ok]))}
            log(f"{axis}: f={fp[axis]['f']:.1f} Hz (spread {fp[axis]['f_spread']:.1f})  zeta={fp[axis]['zeta']:.3f}  peak={fp[axis]['peak_g']:.3f} g  n={len(ok)}")
        else:
            fp[axis] = None; log(f"{axis}: no measurable ringing")
    out = {"name": name, "fingerprint": fp, "per_capture": per}
    json.dump(out, open(os.path.join(outdir, "fingerprint.json"), "w"), indent=2)
    return out


def do_rank(name, s_values=(0.05, 0.1, 0.15, 0.2), top=10, log=print):
    outdir = os.path.join(RING_DIR, name)
    fp = json.load(open(os.path.join(outdir, "fingerprint.json")))["fingerprint"]
    modes = {a: v for a, v in fp.items() if v}
    if not modes:
        sys.exit("no fingerprint to rank against")
    fs = [v["f"] for v in modes.values()]
    F = np.arange(math.floor(0.7 * min(fs)), math.ceil(1.3 * max(fs)) + 0.5, 0.5)
    rows = []
    for kind in SHAPERS:
        for f in F:
            for s in s_values:
                A, T = shaper_impulses(kind, float(f), s)
                res = {a: residual(A, T, m["f"], m["zeta"]) for a, m in modes.items()}
                # robustness: worst residual if the measured mode is off by up to +-10 %
                rob = {a: max(residual(A, T, m["f"] * d, m["zeta"]) for d in (0.9, 0.95, 1.0, 1.05, 1.1)) for a, m in modes.items()}
                rows.append({"shaper": kind, "F": float(f), "S": s, "residual": res, "robust": rob,
                             "worst": max(res.values()), "worst_robust": max(rob.values()), "duration_ms": float(T[-1] * 1000)})
    rows.sort(key=lambda r: (round(r["worst_robust"], 3), r["duration_ms"]))
    # best per shaper type too, so the trade-off is visible
    best_per = {}
    for r in rows:
        best_per.setdefault(r["shaper"], r)
    hdr = f"{'shaper':7s} {'F':>6s} {'S':>5s}  " + "  ".join(f"{a}%" for a in modes) + "  |" + "  ".join(f"{a}+-10%" for a in modes) + "   dur ms"
    fmt = lambda r: f"{r['shaper']:7s} {r['F']:6.1f} {r['S']:5.2f}  " + "  ".join(f"{100 * r['residual'][a]:5.1f}" for a in modes) + "  |" + "  ".join(f"{100 * r['robust'][a]:6.1f}" for a in modes) + f"   {r['duration_ms']:6.1f}"
    log(hdr)
    for r in rows[:top]:
        log(fmt(r))
    log("best of each type (ranked by worst-axis residual with the mode +-10 % off):")
    for k, r in best_per.items():
        log("  " + fmt(r))
    out = {"name": name, "modes": modes, "ranking": rows[:50], "best_per_type": best_per}
    json.dump(out, open(os.path.join(outdir, "ranking.json"), "w"), indent=2)
    return out


def do_verify(board, accel, name, n, repeats, log=print, candidates=None):
    outdir = os.path.join(RING_DIR, name)
    rk = json.load(open(os.path.join(outdir, "ranking.json")))
    base = json.load(open(os.path.join(outdir, "fingerprint.json")))["fingerprint"]
    meta = json.load(open(os.path.join(outdir, "ring.json")))
    prior = board.code("M593")
    log(f"prior: {prior}")
    restore = 'M593 P"none"'
    if "disabled" not in prior:
        # parse e.g. 'Input shaping "zvd" at 40.0Hz damping ratio 0.10, ...'
        import re
        m = re.search(r'"(\w+)".*?([\d.]+)\s*Hz.*?ratio\s*([\d.]+)', prior)
        if m:
            restore = f'M593 P"{m.group(1)}" F{m.group(2)} S{m.group(3)}'
    cands = []
    seen = set()
    if candidates:
        modes = rk["modes"]
        for spec in candidates:                    # "zvdd:52:0.1" or "custom" (ZV x ZV of the two fitted modes)
            if spec == "custom":
                (a1, m1), (a2, m2) = sorted(modes.items())[:2]
                A, T, line = custom_two_mode(m1, m2)
                cands.append({"shaper": "custom", "F": 0.0, "S": 0.0, "code": line, "A": A.tolist(), "T": T.tolist(),
                              "residual": {a: residual(A, T, m["f"], m["zeta"]) for a, m in modes.items()}, "duration_ms": float(T[-1] * 1000)})
            else:
                kind, F, S = spec.split(":"); F, S = float(F), float(S)
                A, T = shaper_impulses(kind, F, S)
                cands.append({"shaper": kind, "F": F, "S": S, "residual": {a: residual(A, T, m["f"], m["zeta"]) for a, m in modes.items()},
                              "duration_ms": float(T[-1] * 1000)})
            cands[-1]["worst"] = max(cands[-1]["residual"].values())
    for r in ([] if candidates else rk["ranking"]):
        key = r["shaper"]
        if key in seen:
            continue
        seen.add(key); cands.append(r)
        if len(cands) == n:
            break
    results = []
    try:
        for c in cands:
            code = c.get("code") or f'M593 P"{c["shaper"]}" F{c["F"]:g} S{c["S"]:g}'
            log(f"== {code}  (predicted worst {100 * c['worst']:.1f}%)")
            rep = board.code(code)
            if rep: log(f"  {rep}")
            sub = f"{name}_v_{c['shaper']}_{c['F']:g}"
            do_ring(board, accel, sub, meta["x0"], meta["y0"], meta["dist"], meta["speed"], repeats, 1500, log)
            fit = do_fit(sub, log)["fingerprint"]
            meas = {}
            for a in ("X", "Y"):
                if base.get(a):
                    pk = fit[a]["peak_g"] if fit.get(a) else None
                    meas[a] = (pk / base[a]["peak_g"]) if pk is not None else 0.0
            results.append({"code": code, "shaper": c["shaper"], "F": c["F"], "S": c["S"], "A": c.get("A"), "T": c.get("T"),
                            "predicted": c["residual"], "measured": meas, "fit": fit})
            log("  measured residual: " + "  ".join(f"{a} {100 * v:.0f}%" for a, v in meas.items()) + "   predicted: " + "  ".join(f"{a} {100 * v:.0f}%" for a, v in c["residual"].items()))
    finally:
        rep = board.code(restore)
        log(f"restored: {restore} {rep}".strip())
    vpath = os.path.join(outdir, "verify.json")
    prev = json.load(open(vpath))["results"] if os.path.exists(vpath) else []
    prev = [r for r in prev if r["code"] not in {x["code"] for x in results}] + results   # accumulate across runs
    json.dump({"name": name, "prior": prior, "results": prev}, open(vpath, "w"), indent=2)
    return results


# ==================================================================== cli
def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("cmd", choices=["ring", "fit", "rank", "verify", "all"])
    p.add_argument("--name", default=time.strftime("ring-%Y%m%d-%H%M"))
    p.add_argument("--target", default=DEFAULT_TARGET)
    p.add_argument("--accel", default="20.0")
    p.add_argument("--x", type=float, default=120); p.add_argument("--y", type=float, default=120)
    p.add_argument("--dist", type=float, default=60)
    p.add_argument("--speed", type=float, default=200)
    p.add_argument("--repeats", type=int, default=3)
    p.add_argument("--samples", type=int, default=1500)
    p.add_argument("--top", type=int, default=3, help="verify: candidates (best of each shaper type)")
    p.add_argument("--candidates", nargs="*", help="verify: explicit list like zvdd:17.5:0.2 (overrides --top)")
    a = p.parse_args()
    board = Board(a.target)
    if a.cmd in ("ring", "all"):
        do_ring(board, a.accel, a.name, a.x, a.y, a.dist, a.speed, a.repeats, a.samples)
    if a.cmd in ("fit", "all"):
        do_fit(a.name)
    if a.cmd in ("rank", "all"):
        do_rank(a.name)
    if a.cmd in ("verify", "all"):
        do_verify(board, a.accel, a.name, a.top, max(1, a.repeats - 1), candidates=a.candidates)


if __name__ == "__main__":
    main()
