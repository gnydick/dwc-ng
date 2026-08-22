#!/usr/bin/env bash
# Full driver/stepper sweep on X (both CoreXY motors), 50 + 100 mm/s, 250 Hz tracked.
# Every trial restores config.g values. Run from repo root.
set -u
R0='M569 P0.0 F3 B1 Y5:0 H2000 U31'; R1='M569 P0.1 F3 B1 Y5:0 H2000 U31'
run(){ name=$1; shift; echo "=== $name"; python tools/accel/accel.py run --trial "$name" --speeds 50,100 --track 250 "$@" 2>&1 | grep -E '^[0-9]+ mm|cruise|^      X|->|unhomed|FAIL|refus'; }
d(){ run "$1" --setup "M569 P0.0 $2" "M569 P0.1 $2" --restore "$R0" "$R1"; }

for ms in '8 I1' '32 I1' '64 I1' '16 I0' '64 I0'; do n=ms${ms/ /_}; run "$n" --setup "M350 X${ms%% *} Y$ms" --restore 'M350 X16 Y16 I1'; done
for k in 500 1000 2000 4000; do run "phase_k$k" --setup 'M970 X1 Y1' "M970.1 X$k Y$k" --restore 'M970 X0 Y0' 'M970.1 X1000 Y1000'; done
for f in 1 2 4 8; do d "f$f" "F$f"; done
for b in 0 3; do d "b$b" "B$b"; done
for y in '1:0' '3:3' '6:6' '8:12'; do d "y${y/:/_}" "Y$y"; done
for u in 12 16 24; do d "u$u" "U$u"; done
for i in 1800 1600 1400 1200; do run "i$i" --setup "M906 X$i Y$i" --restore 'M906 X2000 Y2000'; done
