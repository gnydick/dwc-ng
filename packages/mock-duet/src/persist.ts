/**
 * Opt-in persistence for the mock: one state file holding one snapshot of the
 * whole machine — the virtual SD card AND the setup a session established on
 * it (which axes are homed, which tool is selected).
 *
 * Why it exists (GIT_114): the point is not convenience, it is a MIGRATION
 * TEST. Config migration has only ever been exercised against fixtures written
 * by the same hand as the parser, which tests the parser against its own
 * assumptions. A state file makes a different test possible — state that an
 * older build wrote, through the real UI, against the real endpoints, loaded
 * by a newer build. That is the class of defect that reached the printer on
 * 2026-08-26: a v2 config on the real SD was not loaded, twice, and no unit
 * test could see it because no unit test had a v2 file a v2 UI had written.
 *
 * Default is NO persistence, deliberately. A mock that forgets is a faithful
 * model of a machine that can be wiped, and one that silently remembers can
 * HIDE a config-loading bug — the UI's own localStorage cache already masks
 * that class. `createMockServer` builds a StateStore only when a path is
 * given, and this module is the ONE place in the package that writes to disk.
 *
 * @invariant mock-state-one-snapshot
 * @rung 7  sole-constructor type. `MockSnapshot` carries a brand keyed on a
 *          module-private `unique symbol` (SNAPSHOT_BRAND, never exported), so
 *          no code outside this file can produce a value of that type — not by
 *          object literal, not by cast to a nameable type. `encodeSnapshot`
 *          and `applySnapshot` accept nothing else, and the only producer is
 *          `captureSnapshot`, which reads `machine.sd` and `machine.om` in the
 *          same expression. Persisting one store without the other is
 *          therefore a compile error, not a review note
 * @why the SD tree and the machine's own state are two stores. Persisted
 *      through two paths they drift, and a restored machine claims a homed
 *      axis with no file behind it (GIT_114 design constraint). One snapshot,
 *      one restore — and the type is what makes "one" true
 *
 * @invariant mock-state-atomic-replace
 * @rung 6  choke-point. `writeAtomic` below is the only function in the
 *          package that opens a file for writing, and it writes a temp file in
 *          the destination's own directory, fsyncs it, and renames it over the
 *          destination. A reader therefore observes either the previous file
 *          or the new one, never a prefix of the new one — the mock is
 *          routinely killed with `Stop-Process -Force`, which can land between
 *          any two bytes. On top of that the file carries a CRC-32 of its
 *          payload, so a file damaged by anything OUTSIDE this writer is
 *          reported unreadable and the mock starts clean, rather than
 *          restoring half a machine
 * @why a state file that fails to load presents to the operator as data loss
 *      with extra steps, and a half-restored one is worse still: it looks like
 *      a UI bug
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Buffer } from "node:buffer";
import process from "node:process";
import { crc32 } from "./crc32.ts";
import type { Machine } from "./machine.ts";
import type { GCodeFileInfo, VDir, VNode } from "./files.ts";

/** File format marker + version. Bumping the version rejects older files
 *  outright (reported unreadable) rather than guessing at their shape. */
const STATE_FORMAT = "mock-duet-state";
const STATE_VERSION = 1;

/** Never exported: this is what makes MockSnapshot unconstructable elsewhere. */
declare const SNAPSHOT_BRAND: unique symbol;

type SerNode =
	| { t: "f"; date: string; data: string }
	| { t: "d"; date: string; entries: Record<string, SerNode> };

/**
 * What one snapshot holds.
 *
 * The machine half is deliberately small: what an OPERATOR establishes through
 * the API, never what the simulation computes. Temperatures, positions and job
 * progress are integrated every tick from the scenario and the model, so
 * persisting them would restore a machine mid-move that nothing was moving.
 * Homed axes and the selected tool are the two the ticket names, and both are
 * facts a person put there.
 */
interface SnapshotPayload {
	readonly sd: SerNode;
	readonly fileInfo: readonly (readonly [string, GCodeFileInfo])[];
	readonly thumbnails: readonly (readonly [string, string])[];
	readonly machine: {
		readonly homedAxes: readonly string[];
		readonly currentTool: number;
	};
}

/** A snapshot of BOTH stores. Only `captureSnapshot` can make one. */
export interface MockSnapshot extends SnapshotPayload {
	readonly [SNAPSHOT_BRAND]: true;
}

/** The one producer. Reads the SD tree and the machine state together. */
export function captureSnapshot(machine: Machine): MockSnapshot {
	const payload: SnapshotPayload = {
		sd: serializeNode(machine.sd.root),
		fileInfo: [...machine.sd.fileInfo.entries()].sort(byKey),
		thumbnails: [...machine.sd.thumbnails.entries()].sort(byKey),
		machine: {
			homedAxes: (machine.om.move.axes as { letter: string; homed: boolean }[])
				.filter(axis => axis.homed === true)
				.map(axis => axis.letter),
			currentTool: typeof machine.om.state.currentTool === "number" ? machine.om.state.currentTool : -1,
		},
	};
	return payload as MockSnapshot;
}

/**
 * The one consumer. Restores both halves of the same snapshot — or none of it.
 *
 * The machine is CHECKED against the snapshot before a single field is
 * touched, because a state file taken from one machine and loaded onto another
 * (a different `--snapshot`, a synthetic board instead of the toolchanger) can
 * name a tool or an axis that does not exist here. Applying it anyway restores
 * the SD card and silently drops the tool selection, which is precisely the
 * half-restore this whole module refuses to produce.
 */
export function applySnapshot(machine: Machine, snapshot: MockSnapshot): { ok: true } | { ok: false; reason: string } {
	const letters = new Set((machine.om.move.axes as { letter: string }[]).map(axis => axis.letter));
	const missing = snapshot.machine.homedAxes.filter(letter => !letters.has(letter));
	if (missing.length > 0) {
		return { ok: false, reason: `it records homed axes ${missing.join("/")}, which this machine does not have` };
	}
	if (snapshot.machine.currentTool >= 0 && (machine.om.tools as unknown[])[snapshot.machine.currentTool] == null) {
		return { ok: false, reason: `it selects tool ${snapshot.machine.currentTool}, which this machine does not have` };
	}

	const root = deserializeNode(snapshot.sd);
	// The SD's own class stays in charge of its shape: only its three data
	// members are replaced, so every path helper on it keeps working.
	machine.sd.root = root.type === "d" ? root : { type: "d", date: root.date, entries: new Map() };
	machine.sd.fileInfo = new Map(snapshot.fileInfo.map(([k, v]) => [k, structuredClone(v)]));
	machine.sd.thumbnails = new Map(snapshot.thumbnails.map(([k, v]) => [k, v]));

	const homed = new Set(snapshot.machine.homedAxes);
	for (const axis of machine.om.move.axes as { letter: string; homed: boolean }[]) {
		axis.homed = homed.has(axis.letter);
	}
	// Tool selection is restored by REPLAYING the operator's act, not by poking
	// state.currentTool: selecting a tool also moves every tool's state and its
	// heaters' modes, and a snapshot that set the number alone would restore a
	// machine whose selected tool is off. `execute` is the one execution
	// authority for both dialects, so the restored machine is in exactly the
	// state the T-code left it in.
	if (snapshot.machine.currentTool !== machine.om.state.currentTool) {
		machine.execute(`T${snapshot.machine.currentTool}`);
	}
	machine.bump("move");
	machine.bump("state");
	machine.bump("tools");
	machine.bump("heat");
	machine.bumpVolume(0);
	return { ok: true };
}

/**
 * Header line, then the payload JSON. The CRC covers the payload bytes
 * exactly as written, so verifying it never depends on re-serialising the
 * parsed object identically.
 */
export function encodeSnapshot(snapshot: MockSnapshot): string {
	const payload = JSON.stringify(snapshot, null, "\t");
	const bytes = Buffer.from(payload, "utf8");
	const header = JSON.stringify({
		format: STATE_FORMAT,
		version: STATE_VERSION,
		crc32: crc32(new Uint8Array(bytes)).toString(16).padStart(8, "0"),
		bytes: bytes.length,
	});
	// No trailing newline: the payload is the file's remaining bytes VERBATIM,
	// so a truncation of even one byte fails the length check below rather than
	// being forgiven as "just the newline".
	return `${header}\n${payload}`;
}

export type DecodeResult =
	| { readonly ok: true; readonly snapshot: MockSnapshot }
	| { readonly ok: false; readonly reason: string };

/**
 * Total: every damaged input returns a REASON, never a partial snapshot and
 * never a throw. There is no third outcome for a caller to get wrong.
 */
export function decodeSnapshot(text: string): DecodeResult {
	const split = text.indexOf("\n");
	if (split < 0) return { ok: false, reason: "no header line" };
	let header: unknown;
	try {
		header = JSON.parse(text.slice(0, split));
	} catch {
		return { ok: false, reason: "header is not JSON" };
	}
	if (!isRecord(header)) return { ok: false, reason: "header is not an object" };
	if (header["format"] !== STATE_FORMAT) return { ok: false, reason: `not a ${STATE_FORMAT} file` };
	if (header["version"] !== STATE_VERSION) return { ok: false, reason: `state format version ${String(header["version"])}, expected ${STATE_VERSION}` };

	const payload = text.slice(split + 1);
	const bytes = Buffer.from(payload, "utf8");
	if (header["bytes"] !== bytes.length) {
		return { ok: false, reason: `truncated: ${bytes.length} payload bytes, header says ${String(header["bytes"])}` };
	}
	const sum = crc32(new Uint8Array(bytes)).toString(16).padStart(8, "0");
	if (header["crc32"] !== sum) return { ok: false, reason: `crc32 ${sum}, header says ${String(header["crc32"])}` };

	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return { ok: false, reason: "payload is not JSON" };
	}
	if (!isSnapshotShaped(parsed)) return { ok: false, reason: "payload is not a snapshot" };
	return { ok: true, snapshot: parsed as MockSnapshot };
}

export type RestoreResult =
	| { readonly kind: "restored" }
	| { readonly kind: "fresh" }
	| { readonly kind: "unreadable"; readonly reason: string };

/**
 * The persistence handle. Its constructor is private, so the only way to get
 * one is `openStateStore` — and `createMockServer` calls that only when a
 * state path was asked for. No path, no store, no write.
 */
export class StateStore {
	private lastWritten: string | null = null;
	readonly path: string;

	private constructor(path: string) {
		this.path = path;
	}

	static open(path: string): StateStore {
		return new StateStore(path);
	}

	/** Load the file into `machine`, or say why it could not be. */
	restore(machine: Machine): RestoreResult {
		let text: string;
		try {
			text = readFileSync(this.path, "utf8");
		} catch {
			return { kind: "fresh" };
		}
		const decoded = decodeSnapshot(text);
		if (!decoded.ok) return { kind: "unreadable", reason: decoded.reason };
		const applied = applySnapshot(machine, decoded.snapshot);
		if (!applied.ok) return { kind: "unreadable", reason: applied.reason };
		this.lastWritten = text;
		return { kind: "restored" };
	}

	/** Capture both stores and put them on disk. A no-op when nothing moved. */
	save(machine: Machine): void {
		const text = encodeSnapshot(captureSnapshot(machine));
		if (text === this.lastWritten) return;
		this.writeAtomic(text);
		this.lastWritten = text;
	}

	/**
	 * Write the whole file somewhere else, flush it, then replace the
	 * destination with a rename. The temp file sits in the destination's own
	 * directory so the rename stays within one volume, where it replaces the
	 * directory entry in one step (POSIX rename(2); on Windows Node calls
	 * MoveFileEx with MOVEFILE_REPLACE_EXISTING). A kill at any instant leaves
	 * either the previous complete file or the new complete file — the partial
	 * bytes are only ever in the temp file, which no reader looks at.
	 */
	private writeAtomic(text: string): void {
		const dir = dirname(this.path) || ".";
		mkdirSync(dir, { recursive: true });
		const tmp = join(dir, `.${basename(this.path)}.tmp-${process.pid}`);
		const fd = openSync(tmp, "w");
		try {
			writeSync(fd, text, 0, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(tmp, this.path);
	}
}

export function openStateStore(path: string): StateStore {
	return StateStore.open(path);
}

function byKey(a: readonly [string, unknown], b: readonly [string, unknown]): number {
	return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

function serializeNode(node: VNode): SerNode {
	if (node.type === "f") {
		return { t: "f", date: node.date, data: Buffer.from(node.data).toString("base64") };
	}
	const entries: Record<string, SerNode> = {};
	for (const name of [...node.entries.keys()].sort()) {
		entries[name] = serializeNode(node.entries.get(name)!);
	}
	return { t: "d", date: node.date, entries };
}

function deserializeNode(node: SerNode): VNode {
	if (node.t === "f") {
		return { type: "f", date: node.date, data: new Uint8Array(Buffer.from(node.data, "base64")) };
	}
	const dir: VDir = { type: "d", date: node.date, entries: new Map() };
	for (const [name, child] of Object.entries(node.entries)) dir.entries.set(name, deserializeNode(child));
	return dir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural gate: what comes back off disk is untrusted input, so it is
 *  checked into the branded type here rather than cast on faith. */
function isSnapshotShaped(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (!isSerNode(value["sd"])) return false;
	if (!isPairList(value["fileInfo"]) || !isPairList(value["thumbnails"])) return false;
	const machine = value["machine"];
	if (!isRecord(machine)) return false;
	if (!Array.isArray(machine["homedAxes"]) || machine["homedAxes"].some(a => typeof a !== "string")) return false;
	return typeof machine["currentTool"] === "number";
}

function isSerNode(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value["t"] === "f") return typeof value["data"] === "string" && typeof value["date"] === "string";
	if (value["t"] !== "d" || typeof value["date"] !== "string") return false;
	const entries = value["entries"];
	if (!isRecord(entries)) return false;
	return Object.values(entries).every(isSerNode);
}

function isPairList(value: unknown): boolean {
	return Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string");
}
