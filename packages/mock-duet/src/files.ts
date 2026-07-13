/**
 * In-memory virtual SD card seeded with the standard RRF folder layout.
 * Paths use RRF's volume syntax ("0:/gcodes/file.g"); a bare "/" prefix is
 * treated as volume 0 (matching RRF behaviour).
 */
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

	constructor() {
		seed(this);
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

	mkdir(path: string, date: string): boolean {
		const loc = this.parent(path);
		if (loc === null || loc.dir.entries.has(loc.name)) return false;
		loc.dir.entries.set(loc.name, { type: "d", date, entries: new Map() });
		return true;
	}

	delete(path: string, recursive: boolean): boolean {
		const loc = this.parent(path);
		if (loc === null) return false;
		const node = loc.dir.entries.get(loc.name);
		if (node === undefined) return false;
		if (node.type === "d" && node.entries.size > 0 && !recursive) return false;
		return loc.dir.entries.delete(loc.name);
	}

	move(from: string, to: string, overwrite: boolean): boolean {
		const src = this.parent(from);
		if (src === null) return false;
		const node = src.dir.entries.get(src.name);
		if (node === undefined) return false;
		const dst = this.parent(to);
		if (dst === null) return false;
		if (dst.dir.entries.has(dst.name) && !overwrite) return false;
		src.dir.entries.delete(src.name);
		dst.dir.entries.set(dst.name, node);
		return true;
	}
}

function text(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

function seed(sd: VirtualSD) {
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
	};
	for (const [name, content] of Object.entries(sysFiles)) {
		sd.write(`0:/sys/${name}`, text(content), SEED_DATE);
	}

	sd.write("0:/macros/preheat-pla.g", text("M140 S60\nM104 S210\n"), SEED_DATE);
	sd.write("0:/macros/cooldown.g", text("M104 S0\nM140 S0\nM106 S0\n"), SEED_DATE);

	// A fake sliced job file. Content is synthetic; size/metadata are what matter.
	const benchyBody =
		"; generated by PrusaSlicer 2.9.0 on 2026-07-11 at 18:03:11\n" +
		";TYPE:Custom\nM190 S60\nM109 S210\nG28\nG29 S1\n" +
		"G1 Z0.2 F600\n" +
		Array.from({ length: 400 }, (_, i) =>
			`G1 X${(20 + (i % 180)).toFixed(3)} Y${(20 + ((i * 7) % 160)).toFixed(3)} E${(i * 0.033).toFixed(5)} F3600`
		).join("\n") +
		"\nM104 S0\nM140 S0\nG28 X\nM84\n";
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
}
