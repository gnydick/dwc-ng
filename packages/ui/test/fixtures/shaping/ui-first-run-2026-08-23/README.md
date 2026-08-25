# ui-first-run-2026-08-23

The 36 captures from the first hardware run driven by the Shaping Lab UI, on Gabe's
toolchanger (T0, X at 5 full steps/mm):

- `t0_sweep_{X,Y}_{25,34,45,61,82,110,149,200}.csv` — the 8-speed ladder, 16 files.
- `t0_ring_{X,Y}{p,m}{0..4}.csv` — 20 ring-down decays, five reps per axis per direction.

They are the regression fixture for the 2026-08-23 wrong conclusion (#53, #68): the
sweep's forcing band is 125–1000 Hz, the modes are at 38.7 and 41.5 Hz, and nothing in
that ladder drove them. `shaping-findings-real-run.test.ts` and `shaping-sweep.test.ts`
read this directory.

They lived in `tools/accel/runs/ui-first-run-2026-08-23/` until GIT_80. That is the
capture tool's output tree, `tools/accel/.gitignore` ignores `runs/**/*.csv`, and so
the gate was green only on the machine that took them. Fixtures live here, where the
tooling cannot overwrite them and no ignore rule covers them;
`test/fixtures-are-tracked.test.ts` holds that line.

Do not regenerate them. A new hardware run is a new directory under `tools/accel/runs/`;
these are what the findings were worked out against.
