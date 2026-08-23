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

import { EMERGENCY_STOP } from "@dwc-ng/connector";
import type { GcodeCommand } from "@dwc-ng/connector";
import { impulses, type ShaperSpec } from "../shaping/engine/shapers.ts";
import type { Mm } from "../shaping/engine/units.ts";

/**
 * The two things a command may be assembled from, and their sole producers.
 *
 * A `Param` is the currency of the `gc` tagged template below: an interpolation
 * must be one, and the only ways to obtain one are `n()` for a number and
 * `gcodeQuote()` for a string. A bare `string` is not assignable, so
 * `` gc`M98 P${path}` `` does not compile while
 * `` gc`M98 P${gcodeQuote(path)}` `` does.
 */
declare const param: unique symbol;
export type Param = string & { readonly [param]: true };

/**
 * Trim a number to a compact G-code literal (no trailing ".00").
 *
 * Sole producer of a numeric Param. A number cannot carry a quote or a newline,
 * so there is nothing to escape — the brand records that it was checked by the
 * TYPE, which is the whole guarantee for numeric parameters.
 */
const n = (v: number): Param => String(v) as Param;

/**
 * The only way to build a command string.
 *
 * Every interpolation must already be a Param, so an unquoted operator string
 * cannot be spliced into a command at all — not by a new builder, not by
 * someone in a hurry. Literal text between the holes is this module's own
 * source, which is the trusted part.
 */
/**
 * Join commands that are ALREADY built. Composition, not assembly: both sides
 * came out of gc, so there is nothing here to escape — which is exactly why it
 * is a separate function. Passing raw text to gc is a compile error; passing it
 * here would be indistinguishable from passing a command, so this takes only
 * what other builders produced.
 */
const lines = (...parts: string[]): string => parts.join("\n");

const gc = (parts: TemplateStringsArray, ...values: Param[]): string =>
	parts.reduce((out, part, i) => out + part + (values[i] ?? ""), "");

/**
 * Quote a string parameter the way RRF's quoted strings demand: quotes are
 * mandatory (RRF 3), an embedded `"` escapes by DOUBLING, and `'` (RRF's
 * lowercase-next flag) doubles likewise — an unescaped quote from a
 * filename or an operator's free text would otherwise produce a malformed
 * command. Verified against reference/duet-gcode.md (M98 notes, Quoted
 * Strings). A control character is REFUSED rather than escaped, because
 * doubling has nothing to offer one: a newline ends the command line instead
 * of sitting inside the string.
 *
 * @invariant gcode-quoting
 * @rung 7  sole-constructor type — this is the only producer of a string
 *          `Param`, and `gc`, the only command-assembly form in this module,
 *          accepts nothing else. `` gc`M98 P${path}` `` where path is a string
 *          is a COMPILE error; it has to be `gcodeQuote(path)` first. A new
 *          builder cannot write its own `"${n(value)}"` and reach a command,
 *          because a plain template literal is no longer how commands are made.
 *          The control-character check runs inside that sole producer, so it
 *          covers every string parameter without any builder opting in
 * @why an unquoted operator filename reaching M98 was a real injection: a name
 *      containing a quote closed the parameter early and the remainder was
 *      parsed as further G-code, against a machine with heaters. Promoted from
 *      rung 5 on 2026-08-01 — it had been "the builders below all call it",
 *      which is inspection, and inspection is what the next builder skips.
 *      Control characters added 2026-08-05: the same early-close, by a route
 *      doubling cannot address. Not reachable at the time — a filename is
 *      already filtered by files/path.ts, and an `<input type="text">` strips
 *      newlines — but both of those barriers belong to OTHER systems (that
 *      parser, the DOM), and messagebox/ack.ts already has a path around the
 *      second: MessageBoxPrompt seeds its input straight from the board's
 *      `default`, so an unedited answer never passes through the DOM at all.
 *      What kept it safe was RRF being unable to put a newline in M291's
 *      F"..." parameter, which is RRF's guarantee to withdraw, not ours
 */
/**
 * A bare axis or parameter letter. Some parameters are tokens, not strings —
 * `G28 X`, never `G28 "X"` — so quoting would be wrong and there is nothing to
 * escape. Instead the shape is CHECKED: one letter, or the call throws.
 *
 * Letters reach here from the object model (move.axes[].letter), which is the
 * board talking. Throwing on anything else means a malformed axis becomes a
 * loud failure at the one place that could have spliced it into a command,
 * rather than a silently odd G-code line.
 */
/** A number at a FIXED decimal width. Distinct from n() because the trailing
 *  digits are part of the emitted form: (50/100).toFixed(2) is "0.50", and
 *  re-parsing that through n() would send "0.5" instead. */
const fixed = (value: number, digits: number): Param => value.toFixed(digits) as Param;

/**
 * A number at %g precision: six significant digits, trailing zeros dropped.
 * `52` stays `52` rather than becoming `F52.000`, and a frequency that came out
 * of a curve fit as 51.98732145 is trimmed to what the board can act on. Distinct
 * from n() because a fitted value carries more digits than are meaningful, and
 * from fixed() because the width is not part of the emitted form here.
 *
 * Refuses a non-finite value: NaN.toPrecision(6) is the string "NaN", which n()
 * would happily splice into a command as a parameter the board cannot parse.
 */
const sig = (value: number): Param => {
	if (!Number.isFinite(value)) throw new Error(`not a finite number: ${String(value)}`);
	return n(Number(value.toPrecision(6)));
};

/**
 * RRF's colon-separated numeric list (M593's H and T). Built only out of
 * fixed(), so the joined result contains digits, dots and colons and nothing
 * else — there is no input that could put anything else in it.
 */
const numberList = (values: readonly number[], digits: number): Param =>
	values.map((v) => fixed(v, digits)).join(":") as Param;

export const axisLetter = (value: string): Param => {
	if (!/^[A-Za-z]$/.test(value)) throw new Error(`not an axis letter: ${JSON.stringify(value)}`);
	// Passed through with its CASE INTACT. An earlier draft of this uppercased,
	// which would have been a wrong-axis bug: reference/objectmodel
	// move/Axis.ts's AxisLetter enum lists 'A' and 'a' as SEPARATE axes (:13
	// and :17), so normalising case would silently retarget a lowercase axis.
	// AxisLetter.none is '' (:43), which fails the test above — an axis with no
	// letter cannot be homed or released, and saying so loudly is correct.
	return value as Param;
};

export const gcodeQuote = (value: string): Param => {
	// Doubling escapes " and ', which is the whole of RRF's quoting rule. It has
	// nothing to offer a control character: a newline ENDS the command line
	// rather than sitting inside the string, so the remainder would parse as
	// further G-code. Refused rather than escaped, because there is no escape.
	// Same test and same reasoning as files/path.ts's parseFileName, which
	// rejects these at the boundary that mints a filename.
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) < 0x20) {
			throw new Error(`control character in a quoted parameter: ${JSON.stringify(value)}`);
		}
	}
	return `"${value.replace(/"/g, '""').replace(/'/g, "''")}"` as Param;
};

/**
 * `X180 Y120` — the axis words of a G1. Each pair is an axisLetter and a sig,
 * so the only thing this can produce is letters and numbers; there is no route
 * by which free text reaches a move.
 */
const axisWords = (target: ReadonlyArray<{ readonly axis: string; readonly mm: number }>): Param =>
	target.map((t) => `${axisLetter(t.axis)}${sig(t.mm)}`).join(" ") as Param;

/**
 * An accelerometer, spelled the way M955/M956 address one: `20.0` for device 0
 * on the CAN board at address 20, and the bare `0` for the mainboard's own.
 * Only accelAddr() below can make one.
 */
export type AccelAddr = string & { readonly __accel: true };

/**
 * An accelerometer address as M955/M956 want it in their P parameter.
 *
 * @invariant accelerometer-address-is-a-type
 * @rung 7  sole-constructor type — the brand is unforgeable outside accelAddr(),
 *          so M955 and M956 cannot be handed a tool number, a heater index or a
 *          hand-formatted string. The board.device spelling AND the mainboard's
 *          bare form are decided once, in the only place that can mint one, so a
 *          second caller cannot spell it differently
 * @why P is board.device, not a device number: on this toolchanger every
 *      accelerometer is on a CAN toolboard, so a bare index would silently
 *      address the mainboard instead — a capture from the wrong sensor looks
 *      like a real capture and would be fitted, ranked and applied. The
 *      mainboard exception follows reference/dwc
 *      (plugins/InputShaping/RecordMotionProfileDialog.vue:273-277), which maps
 *      canAddress 0 to "0" and everything else to `${canAddress}.0`; the wiki
 *      (reference/duet-gcode.md, M955 notes) likewise says "Use P0 for an
 *      accelerometer connected locally". DWC and the board win over a general
 *      reading of the bb.nn form
 */
export function accelAddr(boardAddress: number, device: number): AccelAddr {
	if (!Number.isInteger(boardAddress) || boardAddress < 0 || boardAddress > 126) {
		// 0 is the mainboard; 1..126 is the CAN address range (reference/duet-gcode.md M959).
		throw new Error(`not a board address: ${String(boardAddress)}`);
	}
	if (!Number.isInteger(device) || device < 0) {
		throw new Error(`not a device number: ${String(device)}`);
	}
	return (boardAddress === 0 && device === 0 ? "0" : `${boardAddress}.${device}`) as AccelAddr;
}

/** Interpolate a minted address. Sound because accelAddr is its only producer
 *  and it emits digits and one dot. */
const accelParam = (addr: AccelAddr): Param => addr as string as Param;

/** Run a macro file (M98). The P filename is quoted through gcodeQuote. */
const runMacro = (path: string): string => gc`M98 P${gcodeQuote(path)}`;

/**
 * A height-map file name for G29's P parameter.
 *
 * P names a file WITHIN /sys (S0's default is /sys/heightmap.csv and P replaces
 * only the name), but callers hold full paths like "0:/sys/foo.csv". Reducing
 * to the last segment keeps a path from reaching the board and being resolved
 * somewhere unintended. Quoted like every other string parameter, because a
 * name can come from an operator's typing.
 */
const meshFile = (file: string): Param => gcodeQuote(file.split("/").pop() ?? file);

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
	tool === undefined ? code : lines(gc`T${n(tool)}`, code);

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
	homeAxis: (axis: string): string => gc`G28 ${axisLetter(axis)}`,
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
		p === undefined ? gc`T${n(tool)}` : gc`T${n(tool)} P${n(p)}`,
	deselectTool: (p?: number): string => (p === undefined ? "T-1" : gc`T-1 P${n(p)}`),

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
	toolActiveSetpoint: (tool: number, temp: number): string => gc`M568 P${n(tool)} S${n(temp)}`,
	toolStandbySetpoint: (tool: number, temp: number): string => gc`M568 P${n(tool)} R${n(temp)}`,
	/** Mode only — A2/A1/A0 carry no temperature (see toolSetpoints). */
	toolActive: (tool: number): string => gc`M568 P${n(tool)} A2`,
	toolStandby: (tool: number): string => gc`M568 P${n(tool)} A1`,
	toolOff: (tool: number): string => gc`M568 P${n(tool)} A0`,

	/**
	 * --- bed heater (M140): off is the sub-absolute-zero sentinel DWC uses ---
	 *
	 * The bed keeps a setpoint-carrying "active" because M140 has NO mode
	 * parameter — there is no A to send. Setting the bed's temperature IS
	 * turning it on, so splitting it into SET + mode the way M568 allows would
	 * invent a distinction the firmware does not have. The asymmetry with the
	 * tools is the hardware's, not the UI's.
	 */
	bedActive: (index: number, temp: number): string => gc`M140 P${n(index)} S${n(temp)}`,
	bedOff: (index: number): string => gc`M140 P${n(index)} S-273.15`,

	// --- movement ---
	/**
	 * Relative jog — DWC's exact form (MovementPanel.vue). M120/M121 push and
	 * restore the modal state (feedrate, absolute/relative) around a G91
	 * relative move. No H flag: a plain G1 respects axis limits, and jogging
	 * assumes a homed machine (H2 would bypass endstops/limits — wrong here).
	 */
	jog: (axis: string, delta: number, feed: number): string =>
		gc`M120\nG91\nG1 ${axisLetter(axis)}${n(delta)} F${n(feed)}\nM121`,
	extrude: (amount: number, feed: number): string => gc`M83\nG1 E${n(amount)} F${n(feed)}`,
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
	releaseAxis: (axis: string): string => gc`M84 ${axisLetter(axis)}`,

	/** ATX PSU control (reference/dwc ATXPanel.vue:51). */
	atxPower: (on: boolean): string => (on ? "M80" : "M81"),

	/** Start printing a job file (reference/dwc JobFileList.vue / M32). */
	print: (path: string): string => gc`M32 ${gcodeQuote(path)}`,

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
		file === undefined ? "G29 S1" : gc`G29 S1 P${meshFile(file)}`,

	/**
	 * Probe the bed. Bare G29 runs sys/mesh.g when it exists and behaves as
	 * G29 S0 otherwise — so a machine with its own meshing macro keeps using it,
	 * which sending S0 explicitly would silently bypass.
	 */
	probeMesh: (): string => "G29",

	/** Save the CURRENT height map under a chosen name (G29 S3, RRF 2.04+). */
	saveHeightmapAs: (file: string): string => gc`G29 S3 P${meshFile(file)}`,

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
		canAddress === 0 ? "M997" : gc`M997 B${n(canAddress)}`,

	/** Simulate a job file without moving (reference/dwc JobFileList.vue:353). */
	simulate: (path: string): string => gc`M37 P${gcodeQuote(path)}`,

	// --- per-object cancel (M486) ---
	//
	// P cancels, U un-cancels, both by object INDEX (reference/dwc
	// GCodeViewer.vue:915). Indexed explicitly rather than using M486 C, which
	// cancels whichever object is current: the one the operator picked is not
	// necessarily the one printing by the time the command lands.
	cancelObject: (index: number): string => gc`M486 P${n(index)}`,
	resumeObject: (index: number): string => gc`M486 U${n(index)}`,

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
		withTool(opts.selectTool, opts.runMacros === false ? "M702 P0" : "M702"),

	loadFilament: (filament: string, opts: FilamentOpts = {}): string =>
		withTool(
			opts.selectTool,
			lines(
				opts.runMacros === false
					? gc`M701 P0 S${gcodeQuote(filament)}`
					: gc`M701 S${gcodeQuote(filament)}`,
				"M703",
			),
		),

	// --- fans ---
	fan: (index: number, percent: number): string => gc`M106 P${n(index)} S${fixed(percent / 100, 2)}`,

	/**
	 * Clear a heater fault. P is the HEATER INDEX (heat.heaters), not a tool
	 * number — they differ on a toolchanger (reference/dwc
	 * ResetHeaterFaultDialog.vue:58).
	 */
	resetHeaterFault: (heater: number): string => gc`M562 P${n(heater)}`,

	// --- tuning ---
	speedFactor: (percent: number): string => gc`M220 S${n(percent)}`,
	flowFactor: (percent: number): string => gc`M221 S${n(percent)}`,
	babystep: (delta: number): string => gc`M290 R1 Z${n(delta)}`,
	/** Clear accumulated babystepping — the reference's own example form
	 *  (reference/duet-gcode.md M290: "M290 R0 S0 ; clear babystepping"). */
	babystepZero: (): string => "M290 R0 S0",

	// --- message-box replies (M292) ---
	/**
	 * Answer a MessageBox. RRF matches the reply to the prompt by SEQ, so a stale
	 * answer to a box that has already gone cannot be mistaken for a fresh one.
	 * P1 is a distinct answer (cancelled), never "OK with an empty value".
	 */
	ackOk: (seq: number): string => gc`M292 S${n(seq)}`,
	ackCancel: (seq: number): string => gc`M292 P1 S${n(seq)}`,
	ackNumber: (seq: number, value: number): string => gc`M292 R{${n(value)}} S${n(seq)}`,
	/** Operator free text — quoted, because it is the operator's. */
	ackText: (seq: number, text: string): string => gc`M292 R{${gcodeQuote(text)}} S${n(seq)}`,

	// --- motion primitives (the shaping procedure composes these) ---
	//
	// Forms per reference/duet-gcode.md G90/G4/M400/G1. They are separate
	// builders rather than one bundle because the shaping procedure interleaves
	// them with captures, and a bundle would fix an order the procedure needs to
	// choose. joinCommands is how they become one payload.

	/** G90 — absolute positioning. Note this does NOT set extrusion absolute
	 *  (that is M82), and the flag is per input channel. */
	absolute: (): string => "G90",

	/** M400 — wait for the move queue to drain. Bare, so RRF 3.5+ releases the
	 *  axes it owns; S1 would hold them, which a capture has no reason to do. */
	waitMoves: (): string => "M400",

	/** G4 P — dwell in MILLISECONDS (G4 S is the seconds form). Used to let the
	 *  machine come to rest before a capture reads the ring-down. */
	dwell: (ms: number): string => {
		if (!Number.isFinite(ms) || ms < 0) throw new Error(`not a dwell in ms: ${String(ms)}`);
		return gc`G4 P${sig(ms)}`;
	},

	/**
	 * An absolute X/Y move at a given feed rate (mm/min, as F always is).
	 *
	 * Plain G1 — no H flag, like cmd.jog: the shaping procedure only ever runs on
	 * a homed machine and axis limits should apply. G90 is NOT bundled in; the
	 * procedure sends cmd.absolute() once, because repeating a modal per move
	 * would be the same fact stated twice.
	 *
	 * Refuses an empty target (a G1 with no axes is a feed-rate change wearing a
	 * move) and a repeated axis (`G1 X1 X2` is malformed). Both are runtime
	 * refusals — rung 2 — because the parameter shape is fixed by the procedure
	 * API; the honest claim is that they fail loudly at the one place that could
	 * have emitted them, not that they are unrepresentable.
	 */
	moveTo: (target: ReadonlyArray<{ axis: "X" | "Y"; mm: Mm }>, feedMmPerMin: number): string => {
		if (target.length === 0) throw new Error("a move needs at least one axis");
		if (new Set(target.map((t) => t.axis)).size !== target.length) {
			throw new Error(`repeated axis in a move: ${target.map((t) => t.axis).join("")}`);
		}
		return gc`G1 ${axisWords(target)} F${sig(feedMmPerMin)}`;
	},

	// --- accelerometer + input shaping (M955 / M956 / M593) ---

	/**
	 * Report an accelerometer's configuration (M955 with P alone). Sending only P
	 * asks; adding I/S/R would SET, and those settings persist on the board, so
	 * this deliberately carries nothing else — reading the sampling rate must not
	 * change it (reference/duet-gcode.md M955 notes).
	 */
	accelConfig: (addr: AccelAddr): string => gc`M955 P${accelParam(addr)}`,

	/**
	 * Collect `samples` accelerometer readings into a .csv (M956).
	 *
	 * Parameter order P, S, A, F follows reference/dwc
	 * (plugins/InputShaping/RecordMotionProfileDialog.vue:555) and the wiki's own
	 * listing. No X/Y/Z: with them omitted RRF collects all three axes, which is
	 * what the fingerprint wants — the ringing of an X move shows up on Y too.
	 *
	 * `trigger` is M956's A: 0 = start now, 1 = at the start of the next move,
	 * 2 = at the start of that move's deceleration. Typed 0|1|2 rather than
	 * number, so there is no fourth value to send.
	 *
	 * F is a bare file name; RRF puts it in 0:/sys/accelerometer.
	 */
	accelCapture: (addr: AccelAddr, samples: number, trigger: 0 | 1 | 2, file: string): string => {
		if (!Number.isInteger(samples) || samples <= 0) throw new Error(`not a sample count: ${String(samples)}`);
		return gc`M956 P${accelParam(addr)} S${n(samples)} A${n(trigger)} F${gcodeQuote(file)}`;
	},

	/**
	 * Configure input shaping (M593), named or custom.
	 *
	 * The named form is uniform across every shaper RRF knows, so the six cases
	 * share one arm — but they are still WRITTEN OUT, with a `never` default, so
	 * that adding a type to ShaperType stops compilation here until someone has
	 * decided whether it really is a P/F/S shaper. A `spec.type === "custom"`
	 * test would have narrowed the other branch automatically and let a new
	 * shaper through silently.
	 *
	 * The custom form is DERIVED from impulses(spec) rather than re-read off the
	 * spec, so what goes to the board is exactly the train the engine modelled:
	 * H is every amplitude except the last (RRF sets the last to 1 - sum) and T
	 * is every cumulative delay except the first (which is zero), in seconds —
	 * reference/duet-gcode.md M593, RRF 3.6 section. That is also why the lists
	 * are n-1 long by construction rather than by a length check. Widths follow
	 * reference/dwc (InputShaping.vue:289-291), one digit finer on each.
	 */
	inputShaping: (spec: ShaperSpec): string => {
		switch (spec.type) {
			case "zvd":
			case "zvdd":
			case "zvddd":
			case "mzv":
			case "ei2":
			case "ei3":
				return gc`M593 P${gcodeQuote(spec.type)} F${sig(spec.F)} S${sig(spec.S)}`;
			case "custom": {
				const { A, T } = impulses(spec);
				const amplitudes = Array.from(A.subarray(0, A.length - 1));
				const delays = Array.from(T.subarray(1));
				return gc`M593 P${gcodeQuote("custom")} H${numberList(amplitudes, 4)} T${numberList(delays, 5)}`;
			}
			default: {
				const unhandled: never = spec;
				throw new Error(`unknown shaper type: ${String((unhandled as { type: unknown }).type)}`);
			}
		}
	},

	/** Disable input shaping. P"none" is a shaper TYPE, not an absent one, so this
	 *  is a distinct command rather than inputShaping with a missing argument. */
	shapingOff: (): string => gc`M593 P${gcodeQuote("none")}`,

	/** Bare M593 — report the current shaper. No parameters means ASK; any
	 *  parameter would set. */
	queryShaping: (): string => "M593",
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
