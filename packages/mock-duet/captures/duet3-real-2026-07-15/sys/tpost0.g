if global.fan_t0 == -1
    M106 R2
else
    M106 S{global.fan_t0}
M98 P"/macros/tools/tpost" A0.02
M593 P"zvddd" F39.2 S0.10

