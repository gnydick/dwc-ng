/**
 * G-code -> flat toolpath, for the Activity view's 3D viewer. Scope is a
 * visual preview, not a verifier: G0/G1 linear moves are parsed exactly;
 * G2/G3 arcs are approximated as a single chord to their endpoint (I/J
 * ignored) rather than tessellated. Gcode is ASCII in practice, so one JS
 * string UTF-16 code unit is treated as one byte for the offsets that map
 * to RRF's job.filePosition (also a byte count).
 *
 * Feature-type (;TYPE:) and layer-time (M73 P/R + ;LAYER_CHANGE) tracking
 * targets PrusaSlicer/SuperSlicer's verified comment conventions — see
 * docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md.
 * Layer-time is a best-effort heuristic (M73 emission isn't tied to layer
 * boundaries by either slicer) and is simply absent (NaN) when the
 * source file has no M73/LAYER_CHANGE data at all — most files won't,
 * since it's gated behind an opt-in printer setting.
 */

import { mapLabelToFeatureType } from "./featureTypes.ts";

export interface ParsedToolpath {
	positions: Float32Array;
	layerIndex: Uint16Array;
	byteOffset: Float64Array;
	extruding: Uint8Array;
	segmentCount: number;
	layerCount: number;
	/** Per segment: mm of filament extruded (0 for travel). */
	deltaE: Float32Array;
	/** Per segment: last-seen F value (mm/min) at that move. */
	speed: Float32Array;
	/** Per segment: index into featureTypes.ts's FEATURE_TYPE_NAMES/COLORS. */
	featureType: Uint8Array;
	/** Per layer: Z thickness (first layer approximated as its own Z). */
	layerHeights: Float32Array;
	/** Per layer: estimated minutes, NaN if undeterminable (see module doc). */
	layerTimeMinutes: Float32Array;
}

const CMD_RE = /^([A-Za-z])(\d+)/;
const PARAM_RE = /([XYZEF])(-?\d*\.?\d+)/gi;
const M73_R_RE = /\bR(-?\d+\.?\d*)/i;
const MOVE_COMMANDS = new Set(["G0", "G1", "G2", "G3"]);

export function parseGcode(text: string): ParsedToolpath {
	const positions: number[] = [];
	const layerIndex: number[] = [];
	const byteOffset: number[] = [];
	const extruding: number[] = [];
	const deltaE: number[] = [];
	const speed: number[] = [];
	const featureType: number[] = [];
	const layerHeights: number[] = [];
	const layerStartR: number[] = [];

	let x = 0, y = 0, z = 0, e = 0;
	let absolute = true;
	let eAbsolute = true;
	let currentLayer = 0;
	let lastExtrudeZ: number | null = null;
	let offset = 0;
	let currentSpeed = 0;
	let currentFeatureType = 0;
	let lastM73R: number | null = null;

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i]!;
		// A split on "\n" consumes a newline for every element except
		// possibly the last: if the text doesn't end with "\n", the final
		// element has no newline after it, so it must NOT get the +1 (else
		// byteOffset ends up one past the actual end of file). The empty
		// string split() produces for text that DOES end in "\n" behaves
		// correctly either way, since it never contains a parseable line.
		const consumedNewline = i < lines.length - 1 || rawLine === "";
		offset += rawLine.length + (consumedNewline ? 1 : 0);

		const semiIdx = rawLine.indexOf(";");
		if (semiIdx !== -1) {
			const commentText = rawLine.slice(semiIdx + 1).trim();
			if (commentText.startsWith("TYPE:")) {
				currentFeatureType = mapLabelToFeatureType(commentText.slice(5).trim());
			} else if (commentText === "LAYER_CHANGE") {
				layerStartR.push(lastM73R ?? NaN);
			}
		}

		const line = rawLine.replace(/;.*$/, "").replace(/\([^)]*\)/g, "").trim();
		if (line === "") continue;

		const cmdMatch = CMD_RE.exec(line);
		if (!cmdMatch) continue;
		const cmd = `${cmdMatch[1]!.toUpperCase()}${Number(cmdMatch[2])}`;

		if (cmd === "G90") { absolute = true; continue; }
		if (cmd === "G91") { absolute = false; continue; }
		if (cmd === "M82") { eAbsolute = true; continue; }
		if (cmd === "M83") { eAbsolute = false; continue; }
		if (cmd === "M73") {
			const rMatch = M73_R_RE.exec(line);
			if (rMatch) lastM73R = Number(rMatch[1]);
			continue;
		}
		if (!MOVE_COMMANDS.has(cmd)) continue;

		const params: Record<string, number> = {};
		PARAM_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PARAM_RE.exec(line)) !== null) {
			params[m[1]!.toUpperCase()] = Number(m[2]);
		}

		if (params.F !== undefined) currentSpeed = params.F;

		const newX = params.X !== undefined ? (absolute ? params.X : x + params.X) : x;
		const newY = params.Y !== undefined ? (absolute ? params.Y : y + params.Y) : y;
		const newZ = params.Z !== undefined ? (absolute ? params.Z : z + params.Z) : z;
		const newE = params.E !== undefined ? (eAbsolute ? params.E : e + params.E) : e;
		const dE = newE - e;
		const isExtruding = dE > 0;

		positions.push(x, y, z, newX, newY, newZ);
		extruding.push(isExtruding ? 1 : 0);
		byteOffset.push(offset);
		deltaE.push(dE);
		speed.push(currentSpeed);
		featureType.push(currentFeatureType);

		if (isExtruding) {
			if (lastExtrudeZ === null) {
				layerHeights.push(newZ);
			} else if (newZ !== lastExtrudeZ) {
				layerHeights.push(newZ - lastExtrudeZ);
				currentLayer += 1;
			}
			lastExtrudeZ = newZ;
		}
		layerIndex.push(currentLayer);

		x = newX; y = newY; z = newZ; e = newE;
	}

	const layerCount = layerIndex.length > 0 ? currentLayer + 1 : 0;

	const layerTimeMinutes = new Float32Array(layerCount);
	for (let i = 0; i < layerCount; i++) {
		const startR = layerStartR[i];
		const endR = i < layerCount - 1 ? layerStartR[i + 1] : (lastM73R ?? undefined);
		layerTimeMinutes[i] = (typeof startR === "number" && !Number.isNaN(startR) && typeof endR === "number" && !Number.isNaN(endR))
			? startR - endR
			: NaN;
	}

	return {
		positions: new Float32Array(positions),
		layerIndex: new Uint16Array(layerIndex),
		byteOffset: new Float64Array(byteOffset),
		extruding: new Uint8Array(extruding),
		segmentCount: layerIndex.length,
		layerCount,
		deltaE: new Float32Array(deltaE),
		speed: new Float32Array(speed),
		featureType: new Uint8Array(featureType),
		layerHeights: new Float32Array(layerHeights),
		layerTimeMinutes,
	};
}
