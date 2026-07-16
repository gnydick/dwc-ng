/**
 * G-code command builders — the entire 1:1-with-G-code contract in one module.
 * Each control's behavior IS the string produced here; the Control view stamps
 * these onto the buttons (the "controls wear their G-code" signature). A few
 * are convenience compounds (a fixed multi-command bundle in one action) — the
 * only logic allowed beyond a raw command. No conditionals, no safety gating.
 *
 * Exact forms verified against the vendored DWC (reference/dwc) and the real
 * toolchange macros — do not "improve" them from memory.
 */

/** Trim a number to a compact G-code literal (no trailing ".00"). */
const n = (v: number): string => String(v);

export const cmd = {
	// --- homing ---
	homeAll: (): string => "G28",
	homeAxis: (axis: string): string => `G28 ${axis}`,

	// --- tools ---
	selectTool: (tool: number): string => `T${tool}`,
	deselectTool: (): string => "T-1",

	// --- tool heaters (M568): convenience compound sets setpoint AND state ---
	toolActive: (tool: number, temp: number): string => `M568 P${tool} S${n(temp)} A2`,
	toolStandby: (tool: number, temp: number): string => `M568 P${tool} R${n(temp)} A1`,
	toolOff: (tool: number): string => `M568 P${tool} A0`,

	// --- bed heater (M140): off is the sub-absolute-zero sentinel DWC uses ---
	bedActive: (index: number, temp: number): string => `M140 P${index} S${n(temp)}`,
	bedOff: (index: number): string => `M140 P${index} S-273.15`,

	// --- movement ---
	/**
	 * Relative jog — DWC's exact form (MovementPanel.vue). M120/M121 push and
	 * restore the modal state (feedrate, absolute/relative) around a G91
	 * relative move. No H flag: a plain G1 respects axis limits, and jogging
	 * assumes a homed machine (H2 would bypass endstops/limits — wrong here).
	 */
	jog: (axis: string, delta: number, feed: number): string =>
		`M120\nG91\nG1 ${axis}${n(delta)} F${n(feed)}\nM121`,
	extrude: (amount: number, feed: number): string => `M83\nG1 E${n(amount)} F${n(feed)}`,
	couplerLock: (): string => 'M98 P"/macros/tool_lock"',
	couplerUnlock: (): string => 'M98 P"/macros/tool_unlock"',

	// --- fans ---
	fan: (index: number, percent: number): string => `M106 P${index} S${(percent / 100).toFixed(2)}`,

	// --- tuning ---
	speedFactor: (percent: number): string => `M220 S${n(percent)}`,
	flowFactor: (percent: number): string => `M221 S${n(percent)}`,
	babystep: (delta: number): string => `M290 R1 Z${n(delta)}`,
};
