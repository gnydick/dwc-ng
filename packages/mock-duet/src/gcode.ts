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
			if (s !== null) setToolHeater(machine, s, null);
			return "";
		}
		case "M568": {
			const s = param("S"), r = param("R");
			if (s !== null || r !== null) setToolHeater(machine, s, r);
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

function setToolHeater(machine: Machine, active: number | null, standby: number | null): void {
	const om = machine.om;
	const toolNumber = om.state.currentTool >= 0 ? om.state.currentTool : 0;
	const tool = om.tools[toolNumber];
	if (!tool) return;
	for (const h of tool.heaters as number[]) {
		const heater = om.heat.heaters[h];
		if (!heater || heater.state === "fault") continue;
		if (active !== null) {
			heater.active = active;
			tool.active[0] = active;
			if (tool.state === "active" || om.state.currentTool === toolNumber) {
				heater.state = active > 0 ? "active" : "off";
			}
		}
		if (standby !== null) {
			heater.standby = standby;
			tool.standby[0] = standby;
		}
	}
}
