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

export interface FilamentOpts {
	/** Select this tool first. Undefined = act on whatever is already selected. */
	selectTool?: number;
	/** Default true. False sends P0, skipping the filament's own macros. */
	runMacros?: boolean;
}

/**
 * Prepend a tool selection when one is named. Compared against undefined, not
 * truthiness: tool 0 is a real tool, and a falsy test would silently drop its
 * T-code and send the command to whatever was already selected.
 */
const withTool = (tool: number | undefined, code: string): string =>
	tool === undefined ? code : `T${tool}
${code}`;

export const cmd = {
	// --- homing ---
	homeAll: (): string => "G28",
	homeAxis: (axis: string): string => `G28 ${axis}`,

	// --- tools ---
	/**
	 * Select a tool. `p` is RRF's tool-change macro BITMASK, not a tool number:
	 * 1 = tfree, 2 = tpre, 4 = tpost (reference/dwc store/machine/settings.ts:309).
	 * Omitted entirely when undefined, which lets the firmware run all three -
	 * so "no P" and "P7" mean the same thing and we send the shorter form.
	 * P0 runs none of them: the way to move a toolchanger when a change macro
	 * would otherwise drive a broken axis.
	 */
	selectTool: (tool: number, p?: number): string =>
		p === undefined ? `T${tool}` : `T${tool} P${p}`,
	deselectTool: (p?: number): string => (p === undefined ? "T-1" : `T-1 P${p}`),

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

	/**
	 * Release the steppers (M84 — "stop idle hold"). Bare M84 releases every
	 * motor; with axis letters it releases only those. Releasing Z on a machine
	 * whose gantry is not self-locking lets it fall — that is the firmware's
	 * business and the operator's, not something this UI second-guesses.
	 */
	releaseAllMotors: (): string => "M84",
	releaseAxis: (axis: string): string => `M84 ${axis}`,

	/** ATX PSU control (reference/dwc ATXPanel.vue:51). */
	atxPower: (on: boolean): string => (on ? "M80" : "M81"),

	/** Start printing a job file (reference/dwc JobFileList.vue / M32). */
	print: (path: string): string => `M32 "${path}"`,

	/** Simulate a job file without moving (reference/dwc JobFileList.vue:353). */
	simulate: (path: string): string => `M37 P"${path}"`,

	// --- per-object cancel (M486) ---
	//
	// P cancels, U un-cancels, both by object INDEX (reference/dwc
	// GCodeViewer.vue:915). Indexed explicitly rather than using M486 C, which
	// cancels whichever object is current: the one the operator picked is not
	// necessarily the one printing by the time the command lands.
	cancelObject: (index: number): string => `M486 P${index}`,
	resumeObject: (index: number): string => `M486 U${index}`,

	// --- filament (M701/M702/M703) ---
	//
	// Forms verified against reference/dwc FilamentDialog.vue:94-103.
	// M701/M702 act on the CURRENTLY SELECTED tool, so `selectTool` prepends a
	// T-code when the target isn't already current — without it the load would
	// land on whatever tool happened to be selected. `runMacros: false` sends P0,
	// suppressing the filament's own load/unload macros, exactly as P0 does for a
	// tool change. M703 applies the newly loaded filament's config and is part of
	// the load, not a separate step.

	unloadFilament: (opts: FilamentOpts = {}): string =>
		withTool(opts.selectTool, `M702${opts.runMacros === false ? " P0" : ""}`),

	loadFilament: (filament: string, opts: FilamentOpts = {}): string =>
		withTool(
			opts.selectTool,
			`M701${opts.runMacros === false ? " P0" : ""} S"${filament}"
M703`,
		),

	// --- fans ---
	fan: (index: number, percent: number): string => `M106 P${index} S${(percent / 100).toFixed(2)}`,

	/**
	 * Clear a heater fault. P is the HEATER INDEX (heat.heaters), not a tool
	 * number — they differ on a toolchanger (reference/dwc
	 * ResetHeaterFaultDialog.vue:58).
	 */
	resetHeaterFault: (heater: number): string => `M562 P${heater}`,

	// --- tuning ---
	speedFactor: (percent: number): string => `M220 S${n(percent)}`,
	flowFactor: (percent: number): string => `M221 S${n(percent)}`,
	babystep: (delta: number): string => `M290 R1 Z${n(delta)}`,
};
