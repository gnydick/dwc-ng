  
; homec.g
; called to home the C axis (coupler)

M915 C S0 F0 H200

;M400

;crashc
G92 C260
M913 C40			; C MOTOR TO 40% CURRENT
G1 C-350 F2400  ; drive the C-axis to the stop
M913 C100			; C MOTOR TO 100% CURRENT
G1 C5.5 F50000
G92 C0
G1 C126
;Open Coupler
M98 P"/macros/tool_unlock"

M915 C S20 F0 H200 R1
