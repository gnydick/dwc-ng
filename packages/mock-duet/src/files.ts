/**
 * In-memory virtual SD card seeded with the standard RRF folder layout.
 * Paths use RRF's volume syntax ("0:/gcodes/file.g"); a bare "/" prefix is
 * treated as volume 0 (matching RRF behaviour).
 */
import { SEAT_SUPPORT_QOI_BASE64 } from "./fixtures/qoi-seat-support.ts";
export interface VFile {
	type: "f";
	data: Uint8Array;
	date: string;
}
export interface VDir {
	type: "d";
	date: string;
	entries: Map<string, VNode>;
}
export type VNode = VFile | VDir;

export interface FileListEntry {
	type: "f" | "d";
	name: string;
	size: number;
	date: string;
}

/** rr_fileinfo metadata for job files, keyed by normalized path. */
export interface GCodeFileInfo {
	fileName: string;
	size: number;
	lastModified: string;
	filament: number[];
	generatedBy: string;
	height: number;
	layerHeight: number;
	numLayers: number;
	printTime: number;
	simulatedTime: number | null;
	thumbnails: { format: string; width: number; height: number; offset: number; size: number }[];
}

const SEED_DATE = "2026-07-12T09:30:00";

/** A tiny valid 16x16 PNG (opaque teal square), base64. Served by rr_thumbnail. */
export const THUMBNAIL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHElEQVR4nGNgYPj/n4GBgYGB4T8" +
	"DAwMDAwMDAwB1WgP9uUdOfAAAAABJRU5ErkJggg==";

export class VirtualSD {
	root: VDir = { type: "d", date: SEED_DATE, entries: new Map() };
	fileInfo = new Map<string, GCodeFileInfo>();
	thumbnails = new Map<string, string>();

	constructor(configVersion: ConfigSeedVersion = 3) {
		seed(this, configVersion);
	}

	/** "0:/gcodes/x.g" | "/gcodes/x.g" -> ["gcodes","x.g"]; null for other volumes. */
	segments(path: string): string[] | null {
		let p = path.trim().replaceAll("\\", "/");
		if (/^\d+:/.test(p)) {
			if (!p.startsWith("0:")) return null; // only volume 0 is mounted
			p = p.slice(2);
		}
		return p.split("/").filter(s => s.length > 0);
	}

	node(path: string): VNode | null {
		const segs = this.segments(path);
		if (segs === null) return null;
		let cur: VNode = this.root;
		for (const seg of segs) {
			if (cur.type !== "d") return null;
			const next = cur.entries.get(seg);
			if (next === undefined) return null;
			cur = next;
		}
		return cur;
	}

	list(dir: string): FileListEntry[] | "unmounted" | "missing" {
		if (this.segments(dir) === null) return "unmounted";
		const node = this.node(dir);
		if (node === null || node.type !== "d") return "missing";
		return [...node.entries.entries()].map(([name, n]) => ({
			type: n.type,
			name,
			size: n.type === "f" ? n.data.length : 0,
			date: n.date,
		}));
	}

	read(path: string): Uint8Array | null {
		const node = this.node(path);
		return node !== null && node.type === "f" ? node.data : null;
	}

	private parent(path: string): { dir: VDir; name: string } | null {
		const segs = this.segments(path);
		if (segs === null || segs.length === 0) return null;
		const name = segs[segs.length - 1]!;
		let cur: VNode = this.root;
		for (const seg of segs.slice(0, -1)) {
			if (cur.type !== "d") return null;
			const next = cur.entries.get(seg);
			if (next === undefined) return null;
			cur = next;
		}
		return cur.type === "d" ? { dir: cur, name } : null;
	}

	write(path: string, data: Uint8Array, date: string): boolean {
		const loc = this.parent(path);
		if (loc === null) return false;
		const existing = loc.dir.entries.get(loc.name);
		if (existing !== undefined && existing.type === "d") return false;
		loc.dir.entries.set(loc.name, { type: "f", data, date });
		return true;
	}

	/**
	 * Create `path` and every missing directory above it. Idempotent, and it
	 * lives here rather than at the call site so a writer needing a folder has
	 * one call instead of a probe, a branch and a single-level `mkdir` loop of
	 * its own — `mkdir` refuses a missing parent, which is easy to miss.
	 */
	ensureDir(path: string, date: string): boolean {
		const segs = this.segments(path);
		if (segs === null) return false;
		let cur: VNode = this.root;
		for (const seg of segs) {
			if (cur.type !== "d") return false;
			let next = cur.entries.get(seg);
			if (next === undefined) {
				next = { type: "d", date, entries: new Map() };
				cur.entries.set(seg, next);
			}
			cur = next;
		}
		return cur.type === "d";
	}

	mkdir(path: string, date: string): boolean {
		const loc = this.parent(path);
		if (loc === null || loc.dir.entries.has(loc.name)) return false;
		loc.dir.entries.set(loc.name, { type: "d", date, entries: new Map() });
		return true;
	}

	/**
	 * Outcomes are a union, not a boolean, because the two HTTP dialects
	 * map them differently (rr_delete: err 0/1; DSF: 204/404/500). The
	 * distinction lives HERE, in the one store — callers never pre-probe.
	 */
	delete(path: string, recursive: boolean): "ok" | "missing" | "not-empty" {
		const loc = this.parent(path);
		if (loc === null) return "missing";
		const node = loc.dir.entries.get(loc.name);
		if (node === undefined) return "missing";
		if (node.type === "d" && node.entries.size > 0 && !recursive) return "not-empty";
		loc.dir.entries.delete(loc.name);
		return "ok";
	}

	/** Same union rationale as delete: "exists" = destination clobber refused. */
	move(from: string, to: string, overwrite: boolean): "ok" | "missing" | "exists" {
		const src = this.parent(from);
		if (src === null) return "missing";
		const node = src.dir.entries.get(src.name);
		if (node === undefined) return "missing";
		const dst = this.parent(to);
		if (dst === null) return "missing";
		if (dst.dir.entries.has(dst.name) && !overwrite) return "exists";
		src.dir.entries.delete(src.name);
		dst.dir.entries.set(dst.name, node);
		return "ok";
	}
}

function text(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

/**
 * A small, spatially coherent multi-layer square print: a skirt, then 4
 * layers each with an external perimeter + inner perimeter + infill
 * (solid on the first/last layer, sparse in between), real per-layer
 * ;TYPE: tags, and varying F speeds. Not what a real slicer would emit
 * for a "benchy" (it's a square, not a boat) — the point is a genuine,
 * renderable toolpath shape with real feature-type/speed diversity,
 * for exercising the Activity view's gcode viewer against mock data
 * alone, without needing a real slicer export.
 */
function buildSquareGcodeBody(): string {
	const ox = 90, oy = 90; // square's lower-left corner, mm
	const side = 20; // mm
	const layerHeight = 0.2;
	const layerCount = 4;
	const lines: string[] = [
		"; generated by PrusaSlicer 2.9.0 on 2026-07-11 at 18:03:11",
		"M190 S60", "M109 S210", "G28", "G29 S1",
	];
	let e = 0;

	const extrudeTo = (x: number, y: number, len: number, f: number): void => {
		e += len * 0.033;
		lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${e.toFixed(5)} F${f}`);
	};
	/** Travels (no E) to the corner first, so this shape's start isn't
	 *  drawn as one long extruding line from wherever the tool last was. */
	const square = (cx: number, cy: number, s: number, f: number): void => {
		lines.push(`G1 X${cx.toFixed(3)} Y${cy.toFixed(3)} F${f * 2}`);
		extrudeTo(cx + s, cy, s, f);
		extrudeTo(cx + s, cy + s, s, f);
		extrudeTo(cx, cy + s, s, f);
		extrudeTo(cx, cy, s, f);
	};
	const zigzag = (cx: number, cy: number, s: number, spacing: number, f: number): void => {
		let y = cy;
		let dir = 1;
		while (y <= cy + s) {
			const x1 = dir > 0 ? cx : cx + s;
			const x2 = dir > 0 ? cx + s : cx;
			lines.push(`G1 X${x1.toFixed(3)} Y${y.toFixed(3)} F${f * 2}`);
			extrudeTo(x2, y, s, f);
			y += spacing;
			dir *= -1;
		}
	};

	lines.push(`G1 Z${layerHeight.toFixed(2)} F600`);
	lines.push(";TYPE:Skirt");
	square(ox - 3, oy - 3, side + 6, 1800);

	for (let layer = 0; layer < layerCount; layer++) {
		const z = layerHeight * (layer + 1);
		lines.push(`G1 Z${z.toFixed(2)} F600`);
		lines.push(";TYPE:External perimeter");
		square(ox, oy, side, 1800);
		lines.push(";TYPE:Perimeter");
		square(ox + 0.4, oy + 0.4, side - 0.8, 2400);
		if (layer === 0) {
			lines.push(";TYPE:Solid infill");
			zigzag(ox + 1, oy + 1, side - 2, 1.5, 3000);
		} else if (layer === layerCount - 1) {
			lines.push(";TYPE:Top solid infill");
			zigzag(ox + 1, oy + 1, side - 2, 1.5, 2400);
		} else {
			lines.push(";TYPE:Internal infill");
			zigzag(ox + 1, oy + 1, side - 2, 4, 3600);
		}
	}

	lines.push("M104 S0", "M140 S0", "G28 X", "M84");
	return lines.join("\n") + "\n";
}

/**
 * Which shape of `0:/sys/dwc-ng-config.json` to seed.
 *
 * 3 ("current", the default) is what a real board writes today: stamped for
 * this mock's own machine id (its mainboard's uniqueId, snapshot.ts /
 * om-snapshot-2026-07-12.json), carrying the accelerometer mapping the
 * Shaping workflow's Capture step needs to arm at all — GIT_90 round 5,
 * Gabe: the step buttons were disabled because this file had none.
 *
 * 1 and 2 stay selectable (`--config-version`) rather than being replaced
 * outright: GIT_92 requirement 3 is that every state the real UI must
 * handle — including "the SD still carries a pre-v3 file" — has a way to
 * be presented on purpose, not just in the UI's own synthetic unit tests
 * (config-parse.test.ts, config-migrate-v3.test.ts), which exercise the
 * PARSER but never a live mock a person can point the running app at. 1 is
 * byte-for-byte what this file always seeded, so a machine mid-upgrade
 * exercises the same content it always did; 2 carries the current overlay
 * shape (v2 and v3 read identically here — config/parse.ts's
 * `parseOverlayPayload` only transforms `screens.layouts`/`screens.custom`
 * columns for v1, and neither seed sets `screens`) under the pre-split
 * version number, so `version !== CONFIG_VERSION` still fires without a
 * second overlay shape invented for it.
 */
export type ConfigSeedVersion = 1 | 2 | 3;

const MACHINE_ID = "b.0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1";

/**
 * Tool number to accelerometer address ("board.device", M955/M956 P), for
 * the four TOOL1LC boards this snapshot's toolchanger carries — CAN
 * 20/21/22/23, one accelerometer each (om-snapshot-2026-07-12.json
 * `boards`, matching the real 2026-07-15 capture). Device 0: each TOOL1LC
 * carries exactly one.
 */
const ACCEL_BY_TOOL = { "0": "20.0", "1": "21.0", "2": "22.0", "3": "23.0" };

/** The overlay both current-shape versions (2 and 3) share — see the
 *  version doc comment above for why 2 does not need a shape of its own. */
function currentOverlay(): Record<string, unknown> {
	return {
		// U/V/W drive the three individual Z leadscrew motors
		// (M584 U1.0 V1.1 W1.2); C is the tool coupler (C0.2).
		axisRoles: { U: "Z motor 1", V: "Z motor 2", W: "Z motor 3", C: "Coupler" },
		// Tools 0..3 report dock presence on gpIn 10..13 (1 = docked).
		dockSensors: { "0": { gpIn: 10 }, "1": { gpIn: 11 }, "2": { gpIn: 12 }, "3": { gpIn: 13 } },
		shaping: { accelByTool: ACCEL_BY_TOOL },
	};
}

function buildConfigSeed(configVersion: ConfigSeedVersion): string {
	if (configVersion === 1) {
		// Unchanged from every seed before GIT_90 round 5: no accelByTool
		// (the gate this round's default closes), no machineId (v1 predates
		// the stamp), no shaping section at all.
		return JSON.stringify({
			version: 1,
			overlay: {
				axisRoles: { U: "Z motor 1", V: "Z motor 2", W: "Z motor 3", C: "Coupler" },
				dockSensors: { "0": { gpIn: 10 }, "1": { gpIn: 11 }, "2": { gpIn: 12 }, "3": { gpIn: 13 } },
			},
		}, null, "\t");
	}
	if (configVersion === 2) {
		// No machineId: only a v3 payload is stamped and checked
		// (config/migrateStorage.ts readStampedMachineOverlay) — a v2 file
		// never carried one to begin with.
		return JSON.stringify({ version: 2, overlay: currentOverlay() }, null, "\t");
	}
	return JSON.stringify({ version: 3, machineId: MACHINE_ID, overlay: currentOverlay() }, null, "\t");
}

function seed(sd: VirtualSD, configVersion: ConfigSeedVersion) {
	const dirs = ["filaments", "firmware", "gcodes", "macros", "menu", "sys", "www"];
	for (const d of dirs) sd.mkdir(`0:/${d}`, SEED_DATE);

	const sysFiles: Record<string, string> = {
		"config.g": [
			"; Mock Duet 3 Mini 5+ configuration (synthetic, served by @dwc-ng/mock-duet)",
			"G90                                     ; absolute coordinates",
			"M83                                     ; relative extruder moves",
			"M550 P\"mockduet\"                        ; hostname",
			"M669 K1                                 ; CoreXY",
			"M584 X0.0 Y0.1 Z0.2 E0.3                ; drive mapping",
			"M350 X16 Y16 Z16 E16 I1                 ; microstepping",
			"M92 X80 Y80 Z400 E409                   ; steps/mm",
			"M906 X1000 Y1000 Z1000 E800 I30         ; motor currents",
			"M208 X0:220 Y0:195 Z0:240               ; axis limits",
			"M308 S0 P\"temp0\" Y\"thermistor\" T100000 B4092 ; bed sensor",
			"M950 H0 C\"out0\" T0                      ; bed heater",
			"M140 H0",
			"M308 S1 P\"temp1\" Y\"thermistor\" T100000 B4725 ; hotend sensor",
			"M950 H1 C\"out1\" T1                      ; hotend heater",
			"M950 F0 C\"out3\"                         ; part cooling fan",
			"M950 F1 C\"out4\"                         ; hotend fan",
			"M106 P1 T45 H1                          ; thermostatic hotend fan",
			"M563 P0 D0 H1 F0                        ; tool 0",
			"T0                                      ; select tool 0",
			"",
		].join("\n"),
		"homeall.g": "; home all axes\nG91\nG1 H1 X-225 Y-200 F3000\nG1 H1 Z-245 F600\nG90\n",
		"homex.g": "; home X\nG91\nG1 H1 X-225 F3000\nG90\n",
		"homey.g": "; home Y\nG91\nG1 H1 Y-200 F3000\nG90\n",
		"homez.g": "; home Z\nG91\nG1 H1 Z-245 F600\nG90\n",
		"bed.g": "; mesh bed compensation\nM561\nG29\n",
		"pause.g": "; pause script\nM83\nG1 E-2 F3600\nG91\nG1 Z5 F600\nG90\n",
		"resume.g": "; resume script\nG91\nG1 Z-5 F600\nG90\nM83\nG1 E2 F3600\n",
		"stop.g": "; stop script\nM104 S0\nM140 S0\nM106 S0\n",
		// dwc-ng UI config for the machine this mock emulates (Gabe's 6HC
		// toolchanger). The dock indicator and axis-role labels are opt-in —
		// they render only when the SD carries this mapping — so seeding it
		// keeps them working out of the box and across restarts (the SD is
		// rebuilt from this seed on every start). See packages/ui config store.
		// Shape picked by `configVersion` — see buildConfigSeed above.
		"dwc-ng-config.json": buildConfigSeed(configVersion),
	};
	for (const [name, content] of Object.entries(sysFiles)) {
		sd.write(`0:/sys/${name}`, text(content), SEED_DATE);
	}

	sd.write("0:/macros/preheat-pla.g", text("M140 S60\nM104 S210\n"), SEED_DATE);
	sd.write("0:/macros/cooldown.g", text("M104 S0\nM140 S0\nM106 S0\n"), SEED_DATE);

	// Filaments are DIRECTORIES, each holding the macros RRF runs for it. The
	// UI lists these as materials to load (M701 S"<name>"), so an empty
	// 0:/filaments makes the Filament card look broken rather than empty.
	for (const [name, temps] of [["PLA", [60, 210]], ["PETG", [80, 240]], ["Prusament ASA", [100, 260]]] as const) {
		sd.mkdir(`0:/filaments/${name}`, SEED_DATE);
		sd.write(`0:/filaments/${name}/load.g`, text(`M291 P"Loading ${name}" S0 T2
G1 E50 F300
`), SEED_DATE);
		sd.write(`0:/filaments/${name}/unload.g`, text(`G1 E-50 F300
`), SEED_DATE);
		sd.write(`0:/filaments/${name}/config.g`, text(`M140 S${temps[0]}
M104 S${temps[1]}
`), SEED_DATE);
	}

	// A fake sliced job file. Content is synthetic (a small square, not a
	// boat) but spatially coherent and carries real per-layer ;TYPE: tags
	// (PrusaSlicer's own vocabulary, matching the header below) — enough
	// for the Activity view's toolpath color/alpha/width features to have
	// something real to render against using only the mock, without
	// needing a real slicer export. size/job-progress metadata below
	// remain independently authored, decoupled from the actual move
	// count (job progress testing doesn't need a huge file).
	const benchyBody = buildSquareGcodeBody();
	sd.write("0:/gcodes/benchy.gcode", text(benchyBody), "2026-07-11T18:04:22");
	sd.write("0:/gcodes/calibration-cube.gcode", text("; 20mm cube\nG28\n"), "2026-06-30T14:11:05");

	sd.fileInfo.set("0:/gcodes/benchy.gcode", {
		fileName: "0:/gcodes/benchy.gcode",
		size: benchyBody.length,
		lastModified: "2026-07-11T18:04:22",
		filament: [4152.4],
		generatedBy: "PrusaSlicer 2.9.0",
		height: 48,
		layerHeight: 0.2,
		numLayers: 240,
		printTime: 5820,
		simulatedTime: null,
		thumbnails: [{ format: "png", width: 16, height: 16, offset: 64, size: THUMBNAIL_PNG_BASE64.length }],
	});
	sd.thumbnails.set("0:/gcodes/benchy.gcode", THUMBNAIL_PNG_BASE64);

	sd.fileInfo.set("0:/gcodes/calibration-cube.gcode", {
		fileName: "0:/gcodes/calibration-cube.gcode",
		size: 16,
		lastModified: "2026-06-30T14:11:05",
		filament: [812.1],
		generatedBy: "PrusaSlicer 2.9.0",
		height: 20,
		layerHeight: 0.2,
		numLayers: 100,
		printTime: 1260,
		simulatedTime: null,
		thumbnails: [],
	});

	// A real job captured from a real machine: faithful
	// fileinfo + a real 160x160 QOI thumbnail, so the Jobs view exercises the
	// actual QOI decode + chunked rr_thumbnail path offline. The gcode body is
	// synthetic (size is what fileinfo reports); the thumbnail/metadata are real.
	sd.write("0:/gcodes/seat support - PLA.gcode", text("; real fileinfo, synthetic body\n"), "2026-07-03T21:16:18");
	sd.fileInfo.set("0:/gcodes/seat support - PLA.gcode", {
		fileName: "0:/gcodes/seat support - PLA.gcode",
		size: 938253,
		lastModified: "2026-07-03T21:16:18",
		filament: [15463.9],
		generatedBy: "PrusaSlicer 2.9.6 on 2026-07-04 at 04:14:51 UTC",
		height: 30.08,
		layerHeight: 0.32,
		numLayers: 94,
		printTime: 2992,
		simulatedTime: null,
		thumbnails: [{ format: "qoi", width: 160, height: 160, offset: 105, size: SEAT_SUPPORT_QOI_BASE64.length }],
	});
	sd.thumbnails.set("0:/gcodes/seat support - PLA.gcode", SEAT_SUPPORT_QOI_BASE64);
}
