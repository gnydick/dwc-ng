#!/usr/bin/env bash
# Cross designs for the two effective levers (phase stepping, current) vs plausible interactors.
set -u
R0='M569 P0.0 F3 B1 Y5:0 H2000 U31'; R1='M569 P0.1 F3 B1 Y5:0 H2000 U31'
PH_OFF=('M970 X0 Y0' 'M970.1 X1000 Y1000'); I_OFF='M906 X2000 Y2000'; MS_OFF='M350 X16 Y16 I1'
run(){ name=$1; shift; echo "=== $name"; python tools/accel/accel.py run --trial "$name" --speeds 50,100 --track 250 "$@" 2>&1 | grep -E 'FAIL|refus|Error|track' | grep -v '^      Y'; }
# D. noise band
for n in 1 2 3; do run "baseline_r$n"; done
# A. phase-k x current
for k in 500 1000 2000; do for i in 2000 1600 1400 1200; do
  run "A_k${k}_i$i" --setup 'M970 X1 Y1' "M970.1 X$k Y$k" "M906 X$i Y$i" --restore "${PH_OFF[@]}" "$I_OFF"; done; done
# B. current x hysteresis x off-time
for i in 1400 1600; do for y in '1:0' '5:0' '8:5'; do for f in 3 8; do
  run "B_i${i}_y${y/:/_}_f$f" --setup "M906 X$i Y$i" "M569 P0.0 Y$y F$f" "M569 P0.1 Y$y F$f" --restore "$I_OFF" "$R0" "$R1"; done; done; done
# C. phase k1000 x microstepping x current
for ms in 16 32 64; do for i in 2000 1400; do
  run "C_ms${ms}_i$i" --setup "M350 X$ms Y$ms I1" 'M970 X1 Y1' 'M970.1 X1000 Y1000' "M906 X$i Y$i" --restore "$MS_OFF" "${PH_OFF[@]}" "$I_OFF"; done; done
