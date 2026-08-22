#!/usr/bin/env python3
"""Accelerometer trial runner for driver/resonance tuning on a Duet (DSF/SBC).

Local tooling only - NOT part of the web app.  Requires python3 + numpy.

  run      apply setup G-codes, do one constant-velocity move per speed with an
           M956 capture armed on it, pull the CSVs, analyze, ALWAYS run restore
  analyze  re-analyze one or more local CSVs (any M956 capture, incl. old ones)
  compare  side-by-side table of saved trials (runs/<trial>/summary.json)

Examples
  python accel.py run --trial baseline --speeds 20,50,100,200
  python accel.py run --trial hyst5 --setup "M569 P0.0 Y5:2:2" "M569 P0.1 Y5:2:2" \
                      --restore "M569 P0.0 Y4:0:0" "M569 P0.1 Y4:0:0" --track 250
  python accel.py run --trial motorA --axis XY          # CoreXY: +X+Y = motor A (0.1) only
  python accel.py run --trial motorB --axis X-Y         # CoreXY: +X-Y = motor B (0.0) only
  python accel.py compare baseline hyst5
  python accel.py analyze runs/baseline/*.csv --speed 100 --dist 100
"""
import argparse, glob, json, os, sys, time, urllib.parse, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "runs")
ACCEL_DIR = "0:/sys/accelerometer"
DEFAULT_TARGET = "http://duet3.nydick.net"


# ---------------------------------------------------------------- board (DSF)
class Board:
    def __init__(self, base):
        self.base = base.rstrip("/")

    def code(self, line, timeout=120):
        req = urllib.request.Request(f"{self.base}/machine/code", data=line.encode(), method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode().strip()

    def read(self, path):
        url = f"{self.base}/machine/file/{urllib.parse.quote(path, safe='')}"
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def axes(self):
        """{letter: (userPosition, homed)} for all axes."""
        with urllib.request.urlopen(f"{self.base}/machine/model?key=move.axes&flags=d3", timeout=10) as r:
            j = json.load(r)
        axes = (j.get("move") or {}).get("axes") or j.get("axes") or []
        return {a["letter"]: (a["userPosition"], a["homed"]) for a in axes}

    def status(self):
        with urllib.request.urlopen(f"{self.base}/machine/model?key=state.status&flags=d1", timeout=10) as r:
            j = json.load(r)
        return (j.get("state") or {}).get("status") or j.get("status") or "unknown"


# ------------------------------------------------------------------ analysis
def parse_capture(text):
    xs, rate, overflows = [], 0, 0
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Rate "):
            parts = line.replace(",", "").split()
            rate, overflows = int(parts[1]), int(parts[3])
        elif line and line[0].isdigit():
            xs.append([float(v) for v in line.split(",")[1:4]])
    if rate == 0:
        raise ValueError("no 'Rate N, overflows M' trailer - incomplete capture?")
    return rate, overflows, np.array(xs)


def spectrum(x, rate):
    x = x - x.mean()
    w = np.hanning(len(x))
    sp = np.abs(np.fft.rfft(x * w)) * 2 / w.sum()   # amplitude in g
    return np.fft.rfftfreq(len(x), 1 / rate), sp


def top_peaks(fr, sp, n=5, min_hz=5.0):
    m = (sp[1:-1] > sp[:-2]) & (sp[1:-1] >= sp[2:]) & (fr[1:-1] >= min_hz)
    idx = np.nonzero(m)[0] + 1
    idx = idx[np.argsort(sp[idx])[::-1][:n]]
    return [(float(fr[i]), float(sp[i])) for i in idx]


def band_peak(fr, sp, hz, half=5.0):
    m = (fr >= hz - half) & (fr <= hz + half)
    if not m.any():
        return (hz, 0.0)
    i = np.nonzero(m)[0][np.argmax(sp[m])]
    return (float(fr[i]), float(sp[i]))


def analyze(data, rate, overflows, speed, dist, track=None):
    n = len(data)
    captured = n / rate
    move = dist / speed
    windows = []

    def win(name, a, b):
        i, j = int(a * rate), int(b * rate)
        if j - i < 64:
            return
        seg = data[i:j]
        out = {"name": name, "from": i / rate, "to": j / rate, "axes": {}}
        for k, ax in enumerate("xyz"):
            fr, sp = spectrum(seg[:, k], rate)
            d = seg[:, k] - seg[:, k].mean()
            out["axes"][ax] = {
                "rms": float(np.sqrt((d ** 2).mean())),
                "top": top_peaks(fr, sp),
                "tracked": band_peak(fr, sp, track) if track else None,
            }
        windows.append(out)

    win("cruise", 0.1 * move, min(0.9 * move, captured - 0.05))
    if captured - (move + 0.02) >= 0.15:
        win("post", move + 0.02, captured)
    return {"rate": rate, "overflows": overflows, "captured": captured, "move": move, "windows": windows}


def fmt_analysis(a):
    lines = [f"  rate {a['rate']} Hz, {a['captured']:.2f}s captured, move {a['move']:.2f}s"
             + (f", OVERFLOWS {a['overflows']}" if a["overflows"] else "")]
    for w in a["windows"]:
        ax = w["axes"]
        lines.append(f"    {w['name']:6s} {w['from']:.2f}-{w['to']:.2f}s  rms X {ax['x']['rms']:.3f} "
                     f"Y {ax['y']['rms']:.3f} Z {ax['z']['rms']:.3f} g")
        for k in "xy":
            pk = " ".join(f"{hz:.0f}Hz:{g:.3f}" for hz, g in ax[k]["top"][:3])
            tr = ax[k]["tracked"]
            lines.append(f"      {k.upper()} {pk}" + (f"  [track {tr[0]:.0f}Hz:{tr[1]:.3f}]" if tr else ""))
    return "\n".join(lines)


# ----------------------------------------------------------------- commands
def cmd_run(args):
    board = Board(args.target)
    st = board.status()
    if st != "idle":
        sys.exit(f"machine status is '{st}', refusing to move (need idle)")
    probe = board.code(f"M955 P{args.accel}")
    if "samples at" not in probe:
        sys.exit(f"no accelerometer at P{args.accel}: {probe}")
    print(probe)

    # Anything that changes motor current or driver registers in --setup must be
    # undone in --restore; a trial that leaves the machine altered is a bug.
    for code in ("M906", "M569", "M913", "M350", "M970"):
        if any(x.upper().startswith(code) for x in args.setup) and not any(x.upper().startswith(code) for x in args.restore):
            sys.exit(f"--setup uses {code} but --restore does not; refusing to run")
    speeds = [float(s) for s in args.speeds.split(",")]
    outdir = os.path.join(RUNS, args.trial)
    os.makedirs(outdir, exist_ok=True)
    replies, results = [], []

    def send(line):
        r = board.code(line)
        if r:
            replies.append(f"{line} -> {r}")
            print(f"  {line} -> {r}")

    def target(back):
        d = 0 if back else args.dist
        if args.vec:
            dx, dy = (float(v) for v in args.vec.split(","))
            k = d / args.dist
            return f"X{args.x + dx * k:g} Y{args.y + dy * k:g}"
        return {"X": f"X{args.x + d}", "Y": f"Y{args.y + d}",
                "XY": f"X{args.x + d} Y{args.y + d}",      # CoreXY: motor A only
                "X-Y": f"X{args.x + d} Y{args.y - d}"}[args.axis]  # CoreXY: motor B only

    # Driver/stepper config changes can unhome X/Y. Remember where we are and
    # re-assert it with G92 (user position, no motion) if a homed flag drops.
    stored = board.axes()
    if not (stored.get("X", (0, False))[1] and stored.get("Y", (0, False))[1]):
        sys.exit("X/Y not homed, refusing to run")

    def rehome_if_needed(when):
        # DSF's object model lags a config change by a few hundred ms; poll.
        lost = []
        for _ in range(8):
            time.sleep(0.25)
            now = board.axes()
            lost = [ax for ax in "XY" if not now[ax][1]]
            if lost:
                break
        if lost:
            print(f"  {when}: {''.join(lost)} unhomed by config change -> G92 X{stored['X'][0]:g} Y{stored['Y'][0]:g}")
            send(f"G92 X{stored['X'][0]:g} Y{stored['Y'][0]:g}")

    try:
        for s in args.setup:
            send(s)
        rehome_if_needed("after setup")
        send("G90")
        send(f"G1 X{args.x} Y{args.y} F6000")
        send("M400")
        for spd in speeds:
            fname = f"{args.trial}_{args.axis}_{spd:g}.csv"
            print(f"{args.axis} {spd:g} mm/s ...")
            send(f'M956 P{args.accel} S{args.samples} A1 F"{fname}"')
            send(f"G1 {target(False)} F{spd * 60:g}")
            send("M400")
            send("G4 P500")
            send(f"G1 {target(True)} F6000")
            send("M400")
            text = board.read(f"{ACCEL_DIR}/{fname}")
            if text is None:
                raise RuntimeError(f"{fname} not found on board")
            local = os.path.join(outdir, fname)
            with open(local, "w", newline="") as f:
                f.write(text)
            rate, ov, data = parse_capture(text)
            if args.vec:
                dx, dy = (float(v) for v in args.vec.split(","))
                path = (dx * dx + dy * dy) ** 0.5
            else:
                path = args.dist * (2 ** 0.5 if args.axis in ("XY", "X-Y") else 1)
            a = analyze(data, rate, ov, spd, path, args.track)
            results.append({"speed": spd, "csv": fname, "analysis": a})
            print(f"{spd:g} mm/s\n{fmt_analysis(a)}")
    finally:
        for s in args.restore:
            try:
                send(s)
            except Exception as e:  # noqa: BLE001
                print(f"RESTORE FAILED: {s}: {e}")
        rehome_if_needed("after restore")

    summary = {"trial": args.trial, "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "axis": args.axis, "from": [args.x, args.y], "dist": args.dist, "accel": args.accel,
               "setup": args.setup, "restore": args.restore, "track": args.track,
               "replies": replies, "results": results}
    with open(os.path.join(outdir, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nsaved {outdir}/summary.json")


def cmd_analyze(args):
    files = [p for pat in args.files for p in glob.glob(pat)] or args.files
    for p in files:
        rate, ov, data = parse_capture(open(p).read())
        print(p)
        print(fmt_analysis(analyze(data, rate, ov, args.speed, args.dist, args.track)))


def cmd_compare(args):
    trials = []
    for name in args.trials:
        with open(os.path.join(RUNS, name, "summary.json")) as f:
            trials.append(json.load(f))
    speeds = sorted({r["speed"] for t in trials for r in t["results"]})
    col = 28
    print("speed   " + "".join(t["trial"][:col - 1].ljust(col) for t in trials))
    print("        " + "".join("cruise rmsX / peak Hz:g".ljust(col) for _ in trials))
    for s in speeds:
        row = f"{s:<8g}"
        for t in trials:
            r = next((r for r in t["results"] if r["speed"] == s), None)
            w = next((w for w in r["analysis"]["windows"] if w["name"] == "cruise"), None) if r else None
            if not w:
                row += "-".ljust(col)
                continue
            x = w["axes"]["x"]
            pk = x["tracked"] or (x["top"][0] if x["top"] else None)
            row += (f"{x['rms']:.3f} / " + (f"{pk[0]:.0f}:{pk[1]:.3f}" if pk else "-")).ljust(col)
        print(row)
    for t in trials:
        if t["setup"]:
            print(f"\n{t['trial']}: setup = {' ; '.join(t['setup'])}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run")
    r.add_argument("--target", default=DEFAULT_TARGET)
    r.add_argument("--trial", required=True)
    r.add_argument("--accel", default="20.0", help="M955 P value (tool 0 board = 20.0)")
    r.add_argument("--axis", choices=["X", "Y", "XY", "X-Y"], default="X")
    r.add_argument("--x", type=float, default=150)
    r.add_argument("--y", type=float, default=150)
    r.add_argument("--dist", type=float, default=100)
    r.add_argument("--vec", help="explicit move vector 'dx,dy' in mm (overrides --axis/--dist)")
    r.add_argument("--speeds", default="20,50,100,200", help="mm/s, comma separated")
    r.add_argument("--samples", type=int, default=1500)
    r.add_argument("--setup", nargs="*", default=[], help="G-codes before the moves")
    r.add_argument("--restore", nargs="*", default=[], help="G-codes after (always run)")
    r.add_argument("--track", type=float, help="report amplitude at this Hz (+-5)")
    r.set_defaults(fn=cmd_run)

    a = sub.add_parser("analyze")
    a.add_argument("files", nargs="+")
    a.add_argument("--speed", type=float, required=True)
    a.add_argument("--dist", type=float, default=100)
    a.add_argument("--track", type=float)
    a.set_defaults(fn=cmd_analyze)

    c = sub.add_parser("compare")
    c.add_argument("trials", nargs="+")
    c.set_defaults(fn=cmd_compare)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
