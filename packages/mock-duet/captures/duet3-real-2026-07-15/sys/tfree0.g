; tfree0.g
; called when tool 0 is freed
;

set global.fan_t0 = fans[1].actualValue

; Common routine
M98 P"/macros/tools/tfree" X11.5 Y17.7 F1; X param is how far from the end of X axis to go to pick up the tool , Y param is absolute Y position to pick up the tool

;var t = state.currentTool
;var heaterIndex = state.currentTool + 1
;var x = 4.2
;var y = 20.2
;var xMax = move.axes[0].max - var.x

;G60 S0
;if {heat.heaters[var.heaterIndex].current} > 170	
;	G1 E-5 F6000
;	G91
;	G1 Z1
;	G90


;G53 G1 Y{var.y} F12000

;G53 G1 X380 F12000

;G53 G1 X{var.xMax} F2000

;G91
;while sensors.gpIn[10].value == 0
;    G1 X.5
;G90

;M106 P1 S0

;;Open Coupler
;M98 P"/macros/tool_unlock"


;;Move Out
;G53 G1 X380 F12000
;G53 G1 X330 F12000
;M400

M593 P"none"