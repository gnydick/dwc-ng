if global.fan_t2 == -1
    M106 R2
else
    M106 S{global.fan_t2}
M98 P"/macros/tools/tpost" A0.02
M593 P"ei2" F49.6 S0.05
M220 S200