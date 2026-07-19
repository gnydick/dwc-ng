/**
 * G-code -> flat toolpath, for the Activity view's 3D viewer. Scope is a
 * visual preview, not a verifier: G0/G1 linear moves are parsed exactly;
 * G2/G3 arcs are approximated as a single chord to their endpoint (I/J
 * ignored) rather than tessellated. Gcode is ASCII in practice, so one JS
 * string UTF-16 code unit is treated as one byte for the offsets that map
 * to RRF's job.filePosition (also a byte count).
 */

export interface ParsedToolpath {
	positions: Float32Array;
	layerIndex: Uint16Array;
	byteOffset: Float64Array;
	extruding: Uint8Array;
	segmentCount: number;
	layerCount: number;
}

const CMD_RE = /^([A-Za-z])(\d+)/;
const PARAM_RE = /([XYZE])(-?\d*\.?\d+)/gi;
const MOVE_COMMANDS = new Set(["G0", "G1", "G2", "G3"]);

export function parseGcode(text: string): ParsedToolpath {
	const positions: number[] = [];
	const layerIndex: number[] = [];
	const byteOffset: number[] = [];
	const extruding: number[] = [];

	let x = 0, y = 0, z = 0, e = 0;
	let absolute = true;
	let eAbsolute = true;
	let currentLayer = 0;
	let lastExtrudeZ: number | null = null;
	let offset = 0;

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

		const line = rawLine.replace(/;.*$/, "").replace(/\([^)]*\)/g, "").trim();
		if (line === "") continue;

		const cmdMatch = CMD_RE.exec(line);
		if (!cmdMatch) continue;
		const cmd = `${cmdMatch[1]!.toUpperCase()}${Number(cmdMatch[2])}`;

		if (cmd === "G90") { absolute = true; continue; }
		if (cmd === "G91") { absolute = false; continue; }
		if (cmd === "M82") { eAbsolute = true; continue; }
		if (cmd === "M83") { eAbsolute = false; continue; }
		if (!MOVE_COMMANDS.has(cmd)) continue;

		const params: Record<string, number> = {};
		PARAM_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PARAM_RE.exec(line)) !== null) {
			params[m[1]!.toUpperCase()] = Number(m[2]);
		}

		const newX = params.X !== undefined ? (absolute ? params.X : x + params.X) : x;
		const newY = params.Y !== undefined ? (absolute ? params.Y : y + params.Y) : y;
		const newZ = params.Z !== undefined ? (absolute ? params.Z : z + params.Z) : z;
		const newE = params.E !== undefined ? (eAbsolute ? params.E : e + params.E) : e;
		const isExtruding = newE > e;

		positions.push(x, y, z, newX, newY, newZ);
		extruding.push(isExtruding ? 1 : 0);
		byteOffset.push(offset);

		if (isExtruding) {
			if (lastExtrudeZ !== null && newZ !== lastExtrudeZ) currentLayer += 1;
			lastExtrudeZ = newZ;
		}
		layerIndex.push(currentLayer);

		x = newX; y = newY; z = newZ; e = newE;
	}

	return {
		positions: new Float32Array(positions),
		layerIndex: new Uint16Array(layerIndex),
		byteOffset: new Float64Array(byteOffset),
		extruding: new Uint8Array(extruding),
		segmentCount: layerIndex.length,
		layerCount: layerIndex.length > 0 ? currentLayer + 1 : 0,
	};
}
