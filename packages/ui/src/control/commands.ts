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

import { EMERGENCY_STOP } from "../connector/emergency.ts";
import type { GcodeCommand } from "../connector/types.ts";

/** Trim a number to a compact G-code literal (no trailing ".00"). */
const n = (v: number): string => String(v);

/**
 * Quote a string parameter the way RRF's quoted strings demand: quotes are
 * mandatory (RRF 3), an embedded `"` escapes by DOUBLING, and `'` (RRF's
 * lowercase-next flag) doubles likewise — an unescaped quote from a
 * filename or an operator's free text would otherwise produce a malformed
 * command. Verified against reference/duet-gcode.md (M98 notes, Quoted
 * Strings).
 *
 * @invariant gcode-quoting
 * @rung 5  shared helper — the one quoting implementation, imported by
 *          messagebox/ack.ts rather than reimplemented, and pinned by
 *          test/control-commands.test.ts; nothing stops a new builder writing
 *          its own `"${value}"`
 * @why an unquoted operator filename reaching M98 was a real injection: a name
 *      containing a quote closed the parameter early and the remainder was
 *      parsed as further G-code. The builders below all call it, but that is
 *      inspection rather than mechanism, which is what keeps this at 5
 * @debt return a branded QuotedParam instead of string, and have every builder
 *       taking operator text accept only that — then a raw interpolation into a
 *       command string stops compiling rather than merely being unusual.
 */
export const gcodeQuote = (value: string): string =>
	`"${value.replace(/"/g, '""').replace(/'/g, "''")}"`;

/** Run a macro file (M98). The P filename is quoted through gcodeQuote. */
const runMacro = (path: string): string => `M98 P${gcodeQuote(path)}`;

/**
 * A height-map file name for G29's P parameter.
 *
 * P names a file WITHIN /sys (S0's default is /sys/heightmap.csv and P replaces
 * only the name), but callers hold full paths like "0:/sys/foo.csv". Reducing
 * to the last segment keeps a path from reaching the board and being resolved
 * somewhere unintended. Quoted like every other string parameter, because a
 * name can come from an operator's typing.
 */
const meshFile = (file: string): string => gcodeQuote(file.split("/").pop() ?? file);

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

const rawCmd = {
	/**
	 * The STOP button's payload (M112 halt + M999 reset), from the one
	 * definition the write guard and the connector's unblockable path also
	 * read — the button, the guard's allow-through, and the transport's
	 * queue-bypass cannot disagree about what an e-stop is.
	 */
	emergencyStop: (): string => EMERGENCY_STOP,

	// --- homing ---
	homeAll: (): string => "G28",
	homeAxis: (axis: string): string => `G28 ${axis}`,
	/** Run bed.g — bed tramming / leveling. On this toolchanger bed.g levels
	 *  the bed by moving the Z leadscrews (UVW) independently. Bare G32, no
	 *  params (reference/duet-gcode.md G32; DWC sends the same). */
	bedTram: (): string => "G32",

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

	// --- tool heaters (M568) ---
	/**
	 * One setpoint each, mode UNTOUCHED. M568 takes S (active) and R (standby)
	 * independently of each other AND of A (mode), so each field commits on its
	 * own and retargeting a tool never changes which mode it is in.
	 *
	 * These replaced a pair of compounds that each sent one setpoint AND a mode
	 * (`S… A2` / `R… A1`). Both cards fed them the SAME input, so pressing
	 * Standby sent the ACTIVE field's number as R — a tool could not be given
	 * different active and standby setpoints from the UI at all.
	 *
	 * Sending one letter is safe precisely because RRF keeps "any parameter you
	 * don't specify" at its previous value: S alone cannot disturb R. That is
	 * also why each has its own button rather than one button sending both —
	 * a commit writes exactly the field it sits beside, and nothing else.
	 */
	toolActiveSetpoint: (tool: number, temp: number): string => `M568 P${tool} S${n(temp)}`,
	toolStandbySetpoint: (tool: number, temp: number): string => `M568 P${tool} R${n(temp)}`,
	/** Mode only — A2/A1/A0 carry no temperature (see toolSetpoints). */
	toolActive: (tool: number): string => `M568 P${tool} A2`,
	toolStandby: (tool: number): string => `M568 P${tool} A1`,
	toolOff: (tool: number): string => `M568 P${tool} A0`,

	/**
	 * --- bed heater (M140): off is the sub-absolute-zero sentinel DWC uses ---
	 *
	 * The bed keeps a setpoint-carrying "active" because M140 has NO mode
	 * parameter — there is no A to send. Setting the bed's temperature IS
	 * turning it on, so splitting it into SET + mode the way M568 allows would
	 * invent a distinction the firmware does not have. The asymmetry with the
	 * tools is the hardware's, not the UI's.
	 */
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
	runMacro,
	couplerLock: (): string => runMacro("/macros/tool_lock"),
	couplerUnlock: (): string => runMacro("/macros/tool_unlock"),

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

	// --- job control (forms per reference/duet-gcode.md M24/M25/M0; these
	// were raw literals in ActiveJobCard before — audit M3) ---
	resumePrint: (): string => "M24",
	pausePrint: (): string => "M25",
	/** M0: runs cancel.g when paused-and-homed, stop.g otherwise. */
	cancelPrint: (): string => "M0",

	// --- mesh bed compensation (G29) ---
	//
	// Forms per reference/duet-gcode.md G29. NOTE: DWC only ever sends bare
	// G29 / G29 S1 / G29 S2 (MovementPanel.vue:51,59,63) — it has no named-file
	// support at all, so the P forms below have no dwc precedent to defer to and
	// follow the wiki's own examples (G29 S1 P"usual.csv").
	//
	// P is a BARE FILENAME, not a path — see meshFile above.

	/** Load + activate a saved height map (G29 S1; equivalent to M375). */
	loadHeightmap: (file?: string): string =>
		file === undefined ? "G29 S1" : `G29 S1 P${meshFile(file)}`,

	/**
	 * Probe the bed. Bare G29 runs sys/mesh.g when it exists and behaves as
	 * G29 S0 otherwise — so a machine with its own meshing macro keeps using it,
	 * which sending S0 explicitly would silently bypass.
	 */
	probeMesh: (): string => "G29",

	/** Save the CURRENT height map under a chosen name (G29 S3, RRF 2.04+). */
	saveHeightmapAs: (file: string): string => `G29 S3 P${meshFile(file)}`,

	/** Disable mesh compensation AND clear the height map (G29 S2). */
	clearMesh: (): string => "G29 S2",

	// NOTE: no M561 builder — because Gabe does not want the control, NOT because
	// the code is inert. An earlier comment here claimed it was a no-op on this
	// machine; that was wrong. M561 clears the bed transform, and observed on
	// 2026-07-23 mesh compensation goes from active to "none" across a tram,
	// because bed.g runs M561 as its first line. What it does NOT remove here is
	// a plane fit — bed.g drives the leadscrews rather than skewing coordinates
	// — but the mesh it does drop. Deliberately clearing a mesh is G29 S2's job
	// (cmd.clearMesh), which is on the Mesh card and says what it does.

	/**
	 * Update a board's main firmware (M997, module S0 = default). Params per
	 * reference/duet-gcode.md M997: the main board (CAN address 0) takes a bare
	 * M997; a CAN-connected expansion/tool board is targeted with B<canAddress>.
	 * The standard-named binary in 0:/firmware/ is used, so no P — matching the
	 * wiki's own examples (`M997`, `M997 B121`).
	 */
	updateFirmware: (canAddress: number): string =>
		canAddress === 0 ? "M997" : `M997 B${n(canAddress)}`,

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
	/** Clear accumulated babystepping — the reference's own example form
	 *  (reference/duet-gcode.md M290: "M290 R0 S0 ; clear babystepping"). */
	babystepZero: (): string => "M290 R0 S0",

	// --- message-box replies (M292) ---
	/**
	 * Answer a MessageBox. RRF matches the reply to the prompt by SEQ, so a stale
	 * answer to a box that has already gone cannot be mistaken for a fresh one.
	 * P1 is a distinct answer (cancelled), never "OK with an empty value".
	 */
	ackOk: (seq: number): string => `M292 S${n(seq)}`,
	ackCancel: (seq: number): string => `M292 P1 S${n(seq)}`,
	ackNumber: (seq: number, value: number): string => `M292 R{${n(value)}} S${n(seq)}`,
	/** Operator free text — quoted, because it is the operator's. */
	ackText: (seq: number, text: string): string => `M292 R{${gcodeQuote(text)}} S${n(seq)}`,
};

/**
 * Rebrand every builder's return in one place. Each function above still writes
 * a plain string — adding a builder needs no ceremony and cannot forget the
 * brand, because the brand is applied by the TYPE rather than by the author.
 */
type GcodeBuilders<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => GcodeCommand : T[K];
};

export const cmd = rawCmd as GcodeBuilders<typeof rawCmd>;

/**
 * The ONE escape hatch: G-code a human actually typed — the console, or a pin
 * the operator authored themselves. Named, exported from here, and greppable,
 * so "where can an unbuilt command enter?" has a one-line answer.
 *
 * Everything else must come from a builder. If you are reaching for this from a
 * card, the card wants a builder instead.
 */
export const operatorTyped = (text: string): GcodeCommand => text as GcodeCommand;

/**
 * Join built commands into one payload — the convenience compound the project
 * rule allows (a fixed multi-command bundle in one action, no conditionals).
 *
 * Takes GcodeCommand and returns GcodeCommand, so a compound is still made
 * only of sanctioned parts: `[...].join("\n")` would silently drop the brand
 * and force whoever hit it to cast, which is the hole this whole type exists
 * to close.
 */
export const joinCommands = (parts: readonly GcodeCommand[]): GcodeCommand =>
	parts.join("\n") as GcodeCommand;
