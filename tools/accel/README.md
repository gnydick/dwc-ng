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

### Full suite (suite-2026-08-22.sh), 250 Hz peak amplitude in g at 50 / 100 mm/s, pure X

| knob | values tried | result |
|---|---|---|
| baseline | F3 B1 Y5:0 U31, 16 I1, 2000 mA | 0.45 / 1.55 |
| off-time F | 1 (rejected), 2, 4, 5, 8 | 0.36-0.54 / 1.19-1.44 — noise |
| blanking B | 0, 2, 3 | 0.28-0.38 / 1.36-1.66 — noise |
| hysteresis Y | 1:0 2:0 3:1 3:3 4:8 6:6 7:3 8:5 8:12 | 0.46-0.81 / 1.21-1.69 — noise |
| iRun cap U | 12 (fw warns), 16, 20, 24 | 0.60-0.64 / 1.29-1.47 — noise |
| thigh H | 0 | 0.45 / 1.34 — noise |
| microstepping | 8 I1, 32 I1, 64 I1, 16 I0, 64 I0 | 0.49-0.96 / 1.29-1.69 — no better, 64/I0 worse at 50 |
| **phase stepping** M970 + M970.1 k | 250, 500, **1000**, 2000, 4000 | 0.44/0.34, 0.34/0.40, **0.20/0.37**, 0.17/0.47, 0.22/1.26 |
| **current** M906 | 1800, 1600, 1500, 1400, 1200 | 0.39/0.75, 0.23/0.39, 0.16/0.27, 0.16/0.19, 0.11/0.19 |
| phase k1000 + current | 1600, 1200 | 0.30/0.26, 0.32/0.26 |

Only two things work: phase stepping (4x at full current, k=1000 default best)
and lowering current (6-8x at 1400-1500 mA). Combining them does not stack.
Caveats: phase stepping disables stall detection (the Y endstop here is
motorStallAny - homing needs M970 Y0 around it); lower current needs a
skip test at 24000 mm/s^2 before adopting. Config changes (M350, M970)
unhome X/Y; the runner stores tool position and re-asserts it with G92.

### Cross designs (suite-cross-2026-08-22.sh) + repeats — 250 Hz g @100 mm/s

Noise band: baseline x5 = 1.32–1.55 (±8%). The 50 mm/s response drifted
0.45→0.94 over the session, so only 100 mm/s comparisons are trusted.

| | phase off | phase k500 | k1000 | k2000 |
|---|---|---|---|---|
| 2000 mA | 1.55 | 0.39 | 0.51 | 0.67 |
| 1600 mA | 0.39 | 0.32 | 0.31 | 0.32 |
| 1400 mA | 0.19 | 0.25 | 0.30 | 0.31 |
| 1200 mA | 0.19 | 0.17 | 0.23 | 0.20 |

- current x hysteresis x off-time at 1400/1600 mA: all 0.28–0.55, no effect.
- **phase k1000 x 64 µsteps I1: 0.25 / 0.16 / 0.18 at 2000 mA** (x3) — the best
  full-current result, 8x below baseline; 64 µsteps alone and phase alone did
  not get there. At 1400 mA: 0.11 / 0.11 (14x).
- Floor ~0.1–0.2 g regardless of settings: that is the mechanical residual.

Data: runs/dataset.csv (python dataset.py regenerates), raw CSVs per trial
in runs/<trial>/, older DWC-plugin captures in runs/board-archive/.

## Input shaping (shaping.py) — 2026-08-22

`python shaping.py ring|fit|rank|verify|all --name <run>`; envelope X 10–320 / Y 20–260 is a hard refusal.
Note: on RRF 3.6.3 `M956 A2` delivered the whole move, so the stop is detected from the data.

Fingerprint (6 stops per axis): **X 18.1 Hz ζ 0.127 0.05 g; Y 51.6 Hz ζ 0.075 0.10 g.**

| M593 | predicted X/Y residual | measured X/Y |
|---|---|---|
| zvdd F17.5 S0.2 | 0 / 0 % | WORSE: new 38 Hz ring 0.08–0.12 g both axes |
| zvddd F17.5 S0.2 | 0 / 0 % | WORSE: 38 Hz ring 0.10 g |
| zvd F52 S0.1 | 63 / 0 % | X silent, Y 0.03 g (15 Hz remnant) |
| zvdd F52 S0.1 | 50 / 0 % | X silent, Y 0.03 g |
| **ei2 F52 S0.1** | 43 / 1 % | **X silent, Y 0.03 g** — recommended (±39 % band covers tool-mass changes) |

Long shapers split the decel into ~28 ms steps that excite a 38 Hz mode (the 3.6 docs' "artefacts
at direction changes"); the impulse-residual model cannot see that — always verify. RRF's MZV has its
amplitudes reversed vs Klipper's and leaves ~16 % at exact tuning; never ranks well.
| custom ZV(18)⊗ZV(52), 37 ms | 0 / 0 % | X 38 Hz artefact 0.07 g, Y 0.025 g — loses to ei2 |
| ei2 F52 S0.075 | | identical to S0.1: X silent, Y 0.028 g |
