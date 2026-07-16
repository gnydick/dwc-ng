if global.fan_t1 == -1
    M106 R2
else
    M106 S{global.fan_t1}
M98 P"/macros/tools/tpost" A0.020
M593 P"ei2" F49.6 S0.05
