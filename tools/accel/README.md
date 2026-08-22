# tools/accel — accelerometer trial runner (local tooling, not part of the app)

`python accel.py run|analyze|compare` drives the Duet (DSF REST) to run one
constant-velocity move per speed with an M956 capture armed on it, pulls the
CSVs into `runs/<trial>/`, and reports RMS + dominant spectral peaks for the
cruise and post-stop windows. `--setup` codes are applied before the moves and
`--restore` codes ALWAYS after (the runner refuses a setup that touches
M906/M569/M913/M350 without a matching restore). Needs python3 + numpy.

CoreXY motor isolation: `--axis XY` drives only motor A (driver 0.1),
`--axis X-Y` only motor B (0.0); `--vec dx,dy` for arbitrary vectors.

## 2026-08-22 findings (Gabe's toolchanger, RRF 3.6.3, 2000 mA, spreadCycle)

- One fixed ~250 Hz mechanical mode dominates; 1.55 g peak on a pure-X move at
  100 mm/s, 0.45 g at 50 mm/s, ~0 at 20 and small at 200. Present after stop.
- Excited whenever ANY motor runs at ~100 mm/s (electrical 2nd harmonic) or
  ~50 mm/s (4th). Single motor: 0.32 g; both in lockstep (pure X/Y): 1.2–1.55 g.
- Input shaping: no effect (too high for M593). Chopper params H0 / U20 / F2,F5 /
  B2 / Y2:0, Y8:5, Y4:8: all within ±15% noise.
- Motor current is the only effective knob: 2000→1500 mA = 0.27 g (6x lower),
  1000 mA ≈ 0.04 g. Strongly nonlinear → current-driven instability.
- Hysteresis on 3.6.3/TMC5160 takes the two-value form `Y<start>:<end>`; a
  third value is rejected ("Bad hysteresis setting").
