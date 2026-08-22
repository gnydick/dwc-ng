# Input-shaping analysis tool — design (2026-08-22)

Local tooling under `tools/accel/` (Python + numpy + matplotlib; NOT the web app).
Goal: replace the DWC input-shaping plugin's one-hop, uncalibrated spectrum with a
measured ringing fingerprint per axis, a simulated shaper ranking for RRF's single
global `M593`, and an on-machine verification of the top candidates.

## Why the plugin isn't enough
- Reports FFT magnitude, not g; one short test move that rarely lands on the
  speeds that excite the machine; gives an F guess and no damping (S).
- RRF 3.6 applies ONE shaper to all axes, so the decision is a compromise
  between X and Y fingerprints; the plugin can't show that trade-off.

## Components (all in `tools/accel/shaping.py` unless noted)

1. **Ring capture** (`ring` subcommand). For each axis in {X, Y} and direction
   {+, −}: a short move (default 60 mm) at a fast speed (default 200 mm/s) with
   `M956 … A2` so the capture starts at the deceleration segment and records
   the free decay after the stop. Repeats (default 3). Uses `accel.Board` and
   the same guards as `accel.py run`: status idle, X/Y homed, accelerometer
   present, tool position recorded, no G92 ever. Files → `runs/ring/<name>/`.
2. **Fingerprint fit** (`fit`). From each decay: detect stop time (speed
   profile known from the move: decel = M204 value read from the OM), take the
   post-stop window, spectrum in g, pick the dominant peak(s) < 150 Hz, fit
   damping ratio ζ from the log-decrement of the band-passed envelope. Output
   per axis/direction: f (Hz), ζ, peak g, plus secondary peaks. Aggregate per
   axis (median across repeats/directions) into `fingerprint.json`.
3. **Shaper model** (`rank`). Impulse sequences for ZVD, ZVDD, ZVDDD, MZV, EI2,
   EI3 as functions of (f, ζ) — standard closed forms, written from the
   published definitions, not copied from any firmware. Residual vibration of
   shaper (F, S) against a measured mode (f_m, ζ_m) via the standard residual
   formula. Grid over F (0.7–1.3× each axis f) and S {0.05, 0.1, 0.15, 0.2}.
   Score = max residual over axes (worst-axis); also report per-axis residual
   and shaper duration (seconds → "corner slowdown"). Output ranked table.
4. **Verify** (`verify`). Apply top N (default 3) via `M593 P"<type>" F<f> S<s>`,
   repeat step 1 with fewer repeats, fit, report measured residual vs
   predicted. ALWAYS restore the prior `M593` state read before starting
   (`M593` reply parsed; "disabled" → `M593 P"none"`). `M593` is the only
   board state touched.
5. **Spectrogram** (notebook). Frequency × speed × g from the existing sweep
   captures (`lowspeed_stock` + `baseline`), marking the fitted ring
   frequencies so forced lines (250 Hz, full-step rate) are visibly distinct
   from ringing.
6. **Notebook section** appended via `make_notebook.py`: fingerprints, ranking
   table, predicted-vs-measured, final recommended `M593` line.

## Data flow
`ring` → CSVs + `ring.json` (meta) → `fit` → `fingerprint.json` → `rank` →
`ranking.json` → `verify` → `verify.json` → notebook.

## Error handling
- Refuse to move unless idle + homed + accelerometer present (existing guard).
- Overflows in a capture → repeat once, else mark the sample bad and exclude.
- Fit fails (no peak above noise floor 0.02 g, or ζ outside 0.005–0.5) → report
  "no measurable ringing" for that axis rather than a number.
- `verify` restores M593 in a `finally`, same as the runner's restore.

## Testing
- Synthetic decays (known f, ζ, noise) → `fit` recovers f within 2 %, ζ within
  20 %. Synthetic shaper residuals: a shaper at exactly (f, ζ) gives ~0 %.
- On-machine: fingerprint repeats agree within 5 % in f.

## Out of scope
Z, extruders, custom (`P"custom"`) shapers, anything in the UI.
