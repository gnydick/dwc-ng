import type { Machine } from "./machine.ts";

/**
 * Minimal G-code interpreter — just enough to make an interactive UI feel
 * real: temperatures, fans, homing, moves, tool selection, job control and
 * the common report codes. Everything else succeeds silently with an empty
 * reply, exactly like most codes on a real board.
 */
export function executeGCode(machine: Machine, source: string): string {
	// rr_gcode may carry several newline-separated commands (e.g. the jog
	// bundle "M120\nG91\nG1 X10\nM121"). RRF runs every line; so do we, and
	// concatenate their non-empty replies the way the shared reply buffer would.
	const replies: string[] = [];
	for (const line of source.split("\n")) {
		const reply = executeLine(machine, line);
		if (reply !== "") replies.push(reply);
	}
	return replies.join("\n");
}

function executeLine(machine: Machine, line: string): string {
	const code = stripComment(line).trim();
	if (code === "") return "";

	const word = code.split(/\s+/)[0]!.toUpperCase();
	const param = (letter: string): number | null => {
		const match = new RegExp(`(?:^|\\s)${letter}(-?\\d+(?:\\.\\d+)?)`, "i").exec(code.slice(word.length));
		return match ? parseFloat(match[1]!) : null;
	};
	const quoted = (): string | null => /"([^"]*)"/.exec(code)?.[1] ?? null;
	/** The quoted string belonging to one parameter letter, e.g. P"hi" in M291. */
	const quotedParam = (letter: string): string | null =>
		new RegExp(`(?:^|\\s)${letter}"([^"]*)"`, "i").exec(code)?.[1] ?? null;
	/** An RRF array literal of strings, e.g. K{"Yes","No"}. */
	const quotedList = (letter: string): string[] | null => {
		const body = new RegExp(`(?:^|\\s)${letter}\\{([^}]*)\\}`, "i").exec(code)?.[1];
		if (body === undefined) return null;
		return [...body.matchAll(/"([^"]*)"/g)].map(m => m[1]!);
	};
	const om = machine.om;

	// Tool change: T0 / T-1
	if (/^T-?\d+$/.test(word)) {
		const n = parseInt(word.slice(1), 10);
		return selectTool(machine, n);
	}

	switch (word) {
		case "G0":
		case "G1": {
			for (const axis of om.move.axes) {
				const v = param(axis.letter);
				if (v === null) continue;
				// Modal: in relative mode (G91) the word is a delta, not a target.
				axis.userPosition = axis.machinePosition = machine.axesRelative ? axis.userPosition + v : v;
			}
			const e = param("E");
			if (e !== null) {
				const extruder = om.move.extruders[0];
				const pos = machine.extruderRelative ? extruder.position + e : e;
				extruder.rawPosition = extruder.position = pos;
			}
			return "";
		}
		case "G90": machine.axesRelative = false; return "";
		case "G91": machine.axesRelative = true; return "";
		case "M82": machine.extruderRelative = false; return "";
		case "M83": machine.extruderRelative = true; return "";
		case "M120": machine.pushMode(); return "";
		case "M121": machine.popMode(); return "";
		case "G28": {
			const letters = ["X", "Y", "Z"].filter(l => new RegExp(`\\b${l}`, "i").test(code.slice(3)));
			const toHome = letters.length > 0 ? letters : ["X", "Y", "Z"];
			for (const axis of om.move.axes) {
				if (toHome.includes(axis.letter)) {
					axis.homed = true;
					axis.userPosition = axis.machinePosition = axis.min;
				}
			}
			return "";
		}
		case "M104":
		case "M109": {
			const s = param("S");
			// M104/M109 have no mode parameter: setting a temperature IS turning
			// the heater on. That legacy conflation is exactly what M568's A
			// parameter separates, so only this pair sets the mode as a side
			// effect — M568 S below does not.
			if (s !== null) {
				const tool = currentToolNumber(machine);
				setToolHeater(machine, tool, s, null);
				setToolMode(machine, tool, s > 0 ? 2 : 0);
			}
			return "";
		}
		case "M568": {
			// P defaults to the current tool. S/R are the setpoints, A is the mode
			// (0 off / 1 standby / 2 active) — and A is INDEPENDENT of S/R: the UI
			// sends the setpoint and the mode as two separate commands, so an
			// A-only M568 has to be honoured on its own.
			const tool = param("P") ?? currentToolNumber(machine);
			const s = param("S"), r = param("R"), a = param("A");
			if (s !== null || r !== null) setToolHeater(machine, tool, s, r);
			if (a !== null) setToolMode(machine, tool, a);
			return "";
		}
		case "M140":
		case "M190": {
			const s = param("S");
			if (s !== null) {
				const bed = om.heat.heaters[om.heat.bedHeaters[0]];
				bed.active = s;
				bed.state = s > 0 ? "active" : "off";
			}
			return "";
		}
		// Filament load/unload. The card that drives these reads what is loaded
		// straight from move.extruders[].filament, so a mock that accepted them
		// silently left every row saying "nothing loaded" forever and the
		// Unload buttons permanently dead.
		case "M701": {
			const name = quotedParam("S") ?? quoted();
			if (name !== null) setFilament(machine, name);
			return "";
		}
		case "M702": {
			setFilament(machine, "");
			return "";
		}
		// Applies the loaded filament's own config.g. Nothing in the model
		// changes, so an empty reply is the whole of it — but it is named here
		// rather than falling through, because the pair above would be a lie
		// without it.
		case "M703": return "";
		case "M106": {
			const p = param("P") ?? 0;
			const s = param("S") ?? 255;
			const fan = om.fans[p];
			if (fan) fan.requestedValue = Math.min(1, s > 1 ? s / 255 : s);
			return "";
		}
		// Speed and extrusion factors. The object model carries them as
		// FRACTIONS (1 = 100%) while the G-code takes percent, so S120 stores
		// 1.2 - sending the percent straight through would report 12000%.
		case "M220": {
			const s = param("S");
			if (s !== null) om.move.speedFactor = s / 100;
			return "";
		}
		case "M221": {
			const s = param("S");
			const extruder = om.move.extruders[param("D") ?? 0];
			if (s !== null && extruder) extruder.factor = s / 100;
			return "";
		}
		// M486 P<n> cancels object n, U<n> un-cancels it (reference/dwc
		// GCodeViewer.vue:915). Cancelling does not stop the print: RRF keeps
		// going and skips that object's moves, which is the whole point.
		case "M486": {
			const objects = om.job?.build?.objects;
			if (!Array.isArray(objects)) return "";
			const cancel = param("P");
			const resume = param("U");
			let changed = false;
			if (cancel !== null && objects[cancel]) { objects[cancel].cancelled = true; changed = true; }
			if (resume !== null && objects[resume]) { objects[resume].cancelled = false; changed = true; }
			// Bump the owning subtree's counter, as RRF does. Without it the
			// mutation is invisible: the connector is seqs-driven and only
			// re-fetches `job` when its sequence number moves, so the UI would
			// keep showing the old cancelled flags forever.
			if (changed) machine.bump("job");
			return "";
		}
		case "M107": {
			const fan = om.fans[0];
			if (fan) fan.requestedValue = 0;
			return "";
		}
		case "M114": {
			const pos = om.move.axes
				.map((a: any) => `${a.letter}:${a.userPosition.toFixed(3)}`)
				.join(" ");
			const e = om.move.extruders[0].position.toFixed(3);
			return `${pos} E:${e} Count ${om.move.axes.map((a: any) => Math.round(a.machinePosition * a.stepsPerMm)).join(" ")}`;
		}
		case "M118":
			// Macros talk to the operator with M118 S"..." — echoing it is what
			// makes the console testable against a realistic toolchanger macro.
			return quoted() ?? "";
		case "M115":
			return (
				"FIRMWARE_NAME: RepRapFirmware for Duet 3 Mini 5+ FIRMWARE_VERSION: 3.6.3 " +
				"ELECTRONICS: Duet 3 Mini 5+ FIRMWARE_DATE: 2026-01-15"
			);
		case "M32": {
			const name = quoted();
			if (name === null) return "Error: M32: missing file name";
			const path = name.startsWith("0:") || name.startsWith("/") ? name : `0:/gcodes/${name}`;
			return machine.startJob(path) ? `File ${path} selected for printing` : `Error: GCode file "${name}" not found`;
		}
		case "M24":
			machine.resumeJob();
			return "";
		case "M25":
			machine.pauseJob();
			return "";
		case "M0":
		case "M2":
			if (om.state.status === "paused" || om.state.status === "processing") machine.finishJob(true);
			return "";
		// Clear a latched heater fault. RRF refuses to heat until this runs, so
		// a mock that ignores it would make the UI's reset look like it worked.
		case "M562": {
			const index = param("P");
			const heaters = om.heat.heaters as Array<{ state: string } | null>;
			if (index === null) {
				for (const h of heaters) if (h?.state === "fault") h.state = "off";
			} else {
				const heater = heaters[index];
				if (!heater) return `Error: Heater ${index} does not exist`;
				if (heater.state !== "fault") return "";
				heater.state = "off";
			}
			machine.bump("heat");
			return "";
		}
		case "M112":
			om.state.status = "halted";
			machine.bump("state");
			return "";
		case "M999":
			machine.reset();
			return "";
		case "M550": {
			const name = quoted();
			if (name !== null) {
				om.network.name = name;
				machine.bump("network");
			}
			return "";
		}
		// Blocking prompt. On a real board modes >= 2 SUSPEND the running macro
		// until M292 arrives, so the mock has to model the wait, not just the text
		// — otherwise a UI that never answers looks like it works.
		case "M291": {
			const mode = param("S") ?? 1;
			om.state.messageBox = {
				mode,
				seq: machine.nextMessageBoxSeq(),
				title: quotedParam("R") ?? "",
				message: quotedParam("P") ?? "",
				axisControls: param("J"),
				cancelButton: mode === 3 || (param("B") ?? 0) === 1,
				choices: quotedList("K"),
				default: param("F"),
				min: param("L"),
				max: param("H"),
				timeout: param("T") ?? 0,
			};
			machine.bump("state");
			return "";
		}
		// RRF ignores an M292 whose S doesn't match the open box; mirroring that
		// is the only way the UI's seq echoing is actually exercised here.
		case "M292": {
			const open = om.state.messageBox as { seq: number } | null;
			if (open === null) return "";
			const seq = param("S");
			if (seq !== null && seq !== open.seq) return "";
			om.state.messageBox = null;
			machine.bump("state");
			return "";
		}
		default:
			return "";
	}
}

function stripComment(line: string): string {
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '"') inQuotes = !inQuotes;
		else if (line[i] === ";" && !inQuotes) return line.slice(0, i);
	}
	return line;
}

function selectTool(machine: Machine, n: number): string {
	const om = machine.om;
	const tool = om.tools[n];
	if (n >= 0 && !tool) return `Error: Attempt to select non-existent tool ${n}`;
	om.state.previousTool = om.state.currentTool;
	om.state.currentTool = n >= 0 ? n : -1;
	for (const t of om.tools) {
		if (t === null) continue;
		t.state = t.number === n ? "active" : "off";
		for (const h of t.heaters as number[]) {
			const heater = om.heat.heaters[h];
			if (!heater || heater.state === "fault") continue;
			if (t.number === n) {
				heater.state = heater.active > 0 ? "active" : "off";
			} else {
				heater.state = heater.standby > 0 ? "standby" : "off";
			}
		}
	}
	return "";
}

/** M568/M104 without P act on the current tool; with none selected, tool 0. */
function currentToolNumber(machine: Machine): number {
	return machine.om.state.currentTool >= 0 ? machine.om.state.currentTool : 0;
}

/**
 * The setpoints only. Storing a temperature does NOT change the heater's mode:
 * on a real board M568 S sets the active temperature and leaves the heater
 * where it was, and a UI that sends the setpoint before the mode depends on
 * that — the setpoint click must not switch the heater on by itself.
 *
 * The one exception is the tool that is CURRENT and already active: its heater
 * is tracking its active setpoint, so a new setpoint moves it immediately.
 */
function setToolHeater(machine: Machine, toolNumber: number, active: number | null, standby: number | null): void {
	const om = machine.om;
	const tool = om.tools[toolNumber];
	if (!tool) return;
	for (const h of tool.heaters as number[]) {
		const heater = om.heat.heaters[h];
		if (!heater || heater.state === "fault") continue;
		if (active !== null) {
			heater.active = active;
			tool.active[0] = active;
		}
		if (standby !== null) {
			heater.standby = standby;
			tool.standby[0] = standby;
		}
	}
}

/**
 * Load ("" unloads) filament on the CURRENT tool's extruder. M701/M702 take no
 * tool parameter — a caller that means a particular tool selects it first,
 * which is exactly what the T-code ahead of them in a bundle is for.
 */
function setFilament(machine: Machine, name: string): void {
	const om = machine.om;
	const tool = om.tools[currentToolNumber(machine)];
	if (!tool) return;
	// filamentExtruder, not extruders[0] — it is the field the UI reads back,
	// and the two must not be allowed to name different extruders.
	const extruder = om.move.extruders[tool.filamentExtruder ?? -1];
	if (!extruder) return;
	extruder.filament = name;
	// filament is a RARELY-changing field: it does not travel in the live (`f`)
	// projection, so a client only ever sees it by refetching move — which it
	// only does when seqs.move moves. Without this bump the load succeeds and
	// the UI never learns, which is indistinguishable from it having failed.
	machine.bump("move");
}

/** M568 An — 0 off, 1 standby, 2 active. */
function setToolMode(machine: Machine, toolNumber: number, mode: number): void {
	const om = machine.om;
	const tool = om.tools[toolNumber];
	if (!tool) return;
	const state = mode === 2 ? "active" : mode === 1 ? "standby" : "off";
	tool.state = state;
	for (const h of tool.heaters as number[]) {
		const heater = om.heat.heaters[h];
		// A faulted heater does not leave its fault because someone pressed a
		// mode button — only M562 clears it.
		if (!heater || heater.state === "fault") continue;
		heater.state = state;
	}
}
