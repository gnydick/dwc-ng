import type { Machine } from "./machine.ts";
import { POLLED_KEYS } from "./snapshot.ts";

/**
 * rr_model / M409 response builder. Implements the semantics documented in
 * reference/rrf-m409-object-model.md:
 *  - flag letters f / v / n / o / d<n> / a<offset> / p (separators allowed)
 *  - default depth 1 when no key is given and `f` is absent
 *  - array results are chunked: `a<offset>` selects the start index and the
 *    reply's `next` is the first unfetched index (0 = complete)
 *  - `move.axes` is truncated to limits.reportedAxes elements inside a `move`
 *    (non-`f`) result; clients re-fetch key "move.axes" with `a0` to get all
 *  - a `#` key prefix returns the element count of an array
 */
export interface ModelResponse {
	key: string;
	flags: string;
	result: unknown;
	next?: number;
}

interface ParsedFlags {
	live: boolean;
	verbose: boolean;
	nulls: boolean;
	obsolete: boolean;
	depth: number;
	offset: number | null;
}

export function parseFlags(flags: string): ParsedFlags {
	const parsed: ParsedFlags = { live: false, verbose: false, nulls: false, obsolete: false, depth: Infinity, offset: null };
	const re = /([fvnodap])(\d*)/g;
	let match;
	while ((match = re.exec(flags.toLowerCase())) !== null) {
		const [, letter, digits] = match;
		switch (letter) {
			case "f": parsed.live = true; break;
			case "v": parsed.verbose = true; break;
			case "n": parsed.nulls = true; break;
			case "o": parsed.obsolete = true; break;
			case "d": parsed.depth = digits ? parseInt(digits, 10) : Infinity; break;
			case "a": parsed.offset = digits ? parseInt(digits, 10) : 0; break;
		}
	}
	return parsed;
}

/** Objects at the maximum depth are reported as {}. */
function applyDepth(value: unknown, depth: number): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(item => applyDepth(item, depth));
	if (depth <= 0) return {};
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) out[k] = applyDepth(v, depth - 1);
	return out;
}

function resolvePath(root: unknown, path: string): unknown {
	let cur: any = root;
	for (const part of path.split(".")) {
		if (cur === null || cur === undefined || typeof cur !== "object") return null;
		cur = cur[part];
		if (cur === undefined) return null;
	}
	return cur;
}

export function buildModelResponse(machine: Machine, keyParam: string, flagsParam: string, chunkSize: number): ModelResponse {
	const flags = parseFlags(flagsParam);
	const response: ModelResponse = { key: keyParam, flags: flagsParam, result: null };

	if (keyParam === "seqs") {
		response.result = seqsObject(machine);
		return response;
	}

	if (keyParam === "") {
		if (flags.live) {
			response.result = liveModel(machine);
		} else {
			const full: Record<string, unknown> = {};
			for (const key of POLLED_KEYS) full[key] = machine.om[key];
			full.messages = machine.om.messages;
			response.result = applyDepth(full, Number.isFinite(flags.depth) ? flags.depth : 1);
		}
		return response;
	}

	const countOnly = keyParam.startsWith("#");
	const path = countOnly ? keyParam.slice(1) : keyParam;
	let result = resolvePath(machine.om, path);
	if (countOnly) {
		response.result = Array.isArray(result) ? result.length : null;
		return response;
	}

	if (Array.isArray(result)) {
		const start = flags.offset ?? 0;
		const slice = result.slice(start, start + chunkSize);
		response.next = start + slice.length < result.length ? start + slice.length : 0;
		response.result = applyDepth(slice, flags.depth);
		return response;
	}

	// move.axes truncation rule (RRF >= 3.5): unless `f` is given, a `move`
	// result reports at most limits.reportedAxes axes; fetch "move.axes" with
	// `a0` to page through the full array.
	if (path === "move" && !flags.live && result !== null && typeof result === "object") {
		const reported: number = machine.om.limits.reportedAxes ?? 9;
		const move = result as Record<string, unknown>;
		if (Array.isArray(move.axes) && move.axes.length > reported) {
			result = { ...move, axes: move.axes.slice(0, reported) };
		}
	}

	response.result = applyDepth(result, flags.depth);
	return response;
}

export function seqsObject(machine: Machine): Record<string, unknown> {
	return { ...machine.seqs, reply: machine.replySeq, volChanges: [...machine.volSeqs] };
}

/**
 * The `f` (live) projection: the frequently-changing subset of the model,
 * plus the seqs object. Shape mirrors what RRF returns for flags=d99fn.
 */
export function liveModel(machine: Machine): Record<string, unknown> {
	const om = machine.om;
	return {
		// Real boards report null for rails/sensors they lack (e.g. TOOL1LC
		// has no 12V rail) — mirror the null, don't invent a reading
		boards: om.boards.map((b: any) => b === null ? null : ({
			freeRam: b.freeRam,
			mcuTemp: b.mcuTemp ? { current: b.mcuTemp.current } : null,
			v12: b.v12 ? { current: b.v12.current } : null,
			vIn: b.vIn ? { current: b.vIn.current } : null,
		})),
		fans: om.fans.map((f: any) => f === null ? null : ({
			actualValue: f.actualValue,
			requestedValue: f.requestedValue,
			rpm: f.rpm,
		})),
		heat: {
			heaters: om.heat.heaters.map((h: any) => h === null ? null : ({
				active: h.active,
				avgPwm: h.avgPwm,
				current: h.current,
				standby: h.standby,
				state: h.state,
			})),
		},
		job: {
			duration: om.job.duration,
			filePosition: om.job.filePosition,
			layer: om.job.layer,
			layerTime: om.job.layerTime,
			pauseDuration: om.job.pauseDuration,
			rawExtrusion: om.job.rawExtrusion,
			timesLeft: { ...om.job.timesLeft },
			warmUpDuration: om.job.warmUpDuration,
		},
		move: {
			axes: om.move.axes.map((a: any) => ({
				homed: a.homed,
				machinePosition: a.machinePosition,
				userPosition: a.userPosition,
			})),
			currentMove: { ...om.move.currentMove },
			extruders: om.move.extruders.map((e: any) => ({
				position: e.position,
				rawPosition: e.rawPosition,
			})),
			speedFactor: om.move.speedFactor,
		},
		sensors: {
			analog: om.sensors.analog.map((s: any) => s === null ? null : ({ lastReading: s.lastReading })),
			endstops: om.sensors.endstops.map((e: any) => e === null ? null : ({ triggered: e.triggered })),
			probes: om.sensors.probes.map((p: any) => p === null ? null : ({ value: [...p.value] })),
		},
		state: {
			currentTool: om.state.currentTool,
			displayMessage: om.state.displayMessage,
			msUpTime: om.state.msUpTime,
			status: om.state.status,
			time: om.state.time,
			upTime: om.state.upTime,
		},
		seqs: seqsObject(machine),
	};
}
