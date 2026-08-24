/**
 * Transport-agnostic connector abstraction (CLAUDE.md architecture req).
 *
 * The UI layer sees only this interface. PollConnector (standalone rr_ API)
 * implements it now; a DSF/SBC connector implements the same surface later.
 * Nothing above a Connector may know about rr_ endpoints, seqs, sessions, or
 * chunking — those are implementation details that differ per transport.
 */

export type ConnectionStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	/** Connection lost; the connector is trying to get back on its own. */
	| "reconnecting";

export interface ConnectorEvents {
	/**
	 * Authoritative replacement of one top-level object-model subtree
	 * (e.g. "heat"). Merge = wholesale replacement of that subtree.
	 */
	onModelKey?(key: string, value: unknown): void;
	/**
	 * Sparse patch of frequently-changing values (temperatures, positions,
	 * job progress). Deep-merge into the model; fields absent from the patch
	 * are unchanged, never deleted.
	 */
	onModelPatch?(patch: Record<string, unknown>): void;
	/**
	 * The connector-maintained per-layer history changed — WHOLESALE
	 * replacement semantics, deliberately its own event: the patch path's
	 * element-wise array merge never truncates, so a new (shorter) print's
	 * history could not reset through it. RRF keeps no layer history; the
	 * connector is the one producer (synthesized in standalone, fetched from
	 * DSF's model when the rr_ API is emulated).
	 */
	onJobLayers?(layers: unknown[]): void;
	/** A G-code reply / console message arrived. */
	onReply?(text: string): void;
	onStatusChange?(status: ConnectionStatus, detail?: string): void;
	/** Files changed on the given volume (SD card index). */
	onFilesChanged?(volume: number): void;
	/**
	 * Board facts learned at connect time. `emulated` is true when the rr_ API
	 * is served by DSF on an SBC (rr_connect isEmulated) rather than by a
	 * standalone board's own firmware. `transport` names which transport
	 * serves this session: "rr" = standalone rr_, "rr-emulated" = rr_ served
	 * by DSF (i.e. emulated — the flag keeps that exact meaning), "dsf" =
	 * DSF's native /machine API.
	 */
	onBoardInfo?(info: { emulated: boolean; boardType?: string; transport?: ConnectorTransport }): void;
}

/** Which dialect serves a session. Named once; the store and the UI import
 *  it rather than restating the union (a second copy would drift). */
export type ConnectorTransport = "rr" | "rr-emulated" | "dsf";

export interface FileListEntry {
	/** "d" directory | "f" file */
	type: "d" | "f";
	name: string;
	size: number;
	/** ISO-ish timestamp, when the transport provides one. */
	date?: string;
}

/** Descriptor of one embedded thumbnail (see GcodeFileInfo). */
export interface ThumbnailInfo {
	width: number;
	height: number;
	format: "png" | "qoi" | "jpeg";
	/** Opaque offset to pass to getThumbnail. */
	offset: number;
	/** Encoded (base64) size as reported by the board. */
	size: number;
}

/**
 * Parsed metadata for a G-code job file (rr_fileinfo / DSF fileinfo). Optional
 * fields are absent when the slicer didn't emit them — the UI must not assume
 * presence.
 */
export interface GcodeFileInfo {
	fileName: string;
	size: number;
	lastModified?: string;
	/** Object height, mm. */
	height?: number;
	layerHeight?: number;
	numLayers?: number;
	/** Slicer-estimated print time, seconds. */
	printTime?: number;
	simulatedTime?: number;
	/** Filament used per extruder, mm. */
	filament: number[];
	generatedBy: string;
	thumbnails: ThumbnailInfo[];
}

declare const gcode: unique symbol;

/**
 * A G/M/T-code that came from a sanctioned producer.
 *
 * @invariant gcode-producers
 * @rung 7  branded type — `sendCode` accepts only this, and the brand is
 *          unforgeable outside its producers: the `cmd.*` builders (rebranded
 *          wholesale by a mapped type in control/commands.ts), messagebox
 *          ack.ts, the data-defined controls' resolveTemplate, and ONE named
 *          escape hatch, `operatorTyped`, for text a human actually typed. A
 *          hand-assembled string no longer compiles
 * @why an unquoted operator filename reaching M98 was a real injection: a name
 *      containing a quote closed the parameter early and the rest was parsed as
 *      further G-code. Routing every producer through gcodeQuote fixed that
 *      instance; the parameter's TYPE is what stops the next one arriving by a
 *      different route. This is the promotion the 2026-07-22 audit committed to
 *      and did not make — unrecorded for 136 commits, which is why the register
 *      now generates itself
 */
export type GcodeCommand = string & { readonly [gcode]: true };

/**
 * The read half: observing the machine and its files. The dev write guard
 * passes everything here through unconditionally, so WHERE a method is
 * declared IS its classification (audit M5) — a new method goes in
 * ConnectorWrites unless it provably cannot change machine state, and the
 * guard follows the declaration by construction.
 */
export interface ConnectorReads {
	/** Download a text file (configs, macros). */
	download(path: string): Promise<string>;
	/** List a directory. */
	list(dir: string): Promise<FileListEntry[]>;
	/** Parse a job file's metadata (height, filament, layers, thumbnails). */
	getFileInfo(path: string): Promise<GcodeFileInfo>;
	/**
	 * Fetch one embedded thumbnail by its offset (from GcodeFileInfo), returning
	 * the decoded image bytes. The transport hides chunking and base64; the
	 * caller decodes by ThumbnailInfo.format (QOI via decodeQoi, png/jpeg as a
	 * Blob).
	 */
	getThumbnail(path: string, offset: number): Promise<Uint8Array>;
}

/**
 * Per-call concerns for {@link ConnectorWrites.sendCode}.
 *
 * An OPTIONS OBJECT rather than a positional `timeoutMs`, chosen for two
 * reasons and not for taste. A second per-call concern already exists in the
 * implementations — PollConnector routes every send at a fixed
 * `RequestPriority` and the run loop carries an `AbortSignal` its transport
 * never sees — so this is the first of a set, not a one-off. And widening an
 * object is source-compatible at every call site, where widening a positional
 * argument is not: a caller that omits this gets EXACTLY today's behaviour,
 * which is the property that lets the deadline be added to the four codes that
 * need it and to nothing else.
 *
 * Every field is optional, so `{}` and omission mean the same thing.
 */
export type SendCodeOptions = {
	/**
	 * How long the transport may stay busy with THIS code, in milliseconds,
	 * replacing the connector's flat per-request budget for this call only.
	 *
	 * For a CALLER that knows how long its code will take to execute — the
	 * shaping lab derives a `G4 P<dwell>` from the recording it just sized —
	 * this is that duration plus its margin. Nobody else should pass it: the
	 * flat default is right for a code whose duration is unknown, and a bigger
	 * flat default would be wrong for the same reason 5000 is (it punishes
	 * every short request and still fails the first code that outlives it).
	 *
	 * Each transport honours it in ITS OWN TERMS, because the two do not agree
	 * on what a long code costs:
	 *
	 * - DSF (`POST /machine/code`) does not answer until the code has
	 *   EXECUTED, so a long code is literally a long request: this becomes
	 *   that request's timeout.
	 * - Standalone (`rr_gcode` + `rr_reply`) buffers the code and drains the
	 *   reply separately, so a long code is NOT a long request — but a board
	 *   busy for seconds answers `rr_gcode` with 503 until its buffer frees.
	 *   There this bounds the busy/503 recovery ladder IN TIME rather than in
	 *   retries, and is the request budget for the send and the drain behind
	 *   it.
	 *
	 * It is a CEILING on waiting, never a floor: a code that finishes early
	 * resolves early on both transports.
	 */
	readonly timeoutMs?: number;
};

/**
 * The write half: everything that can change the machine or its SD card.
 * The dev write guard fails ALL of this closed on the real board unless
 * writes are armed (sendCode's e-stop pass-through is the one documented
 * exception).
 */
export interface ConnectorWrites {
	/**
	 * Execute a G/M/T-code; resolves with its reply text ("" if none came).
	 *
	 * `opts.timeoutMs` lets a caller that has already computed how long its
	 * code will take say so (see {@link SendCodeOptions}); omitting it is
	 * exactly the behaviour every call site had before the option existed.
	 * The e-stop pass-through above ignores it — that payload is recognised at
	 * the transport before any budget, gate or queue applies.
	 */
	sendCode(code: GcodeCommand, opts?: SendCodeOptions): Promise<string>;
	/**
	 * Upload a file, verified as strongly as the transport allows: rr_ carries
	 * a CRC32 the board checks; DSF's PUT has no integrity mechanism (success
	 * is the 201). `onProgress`, when supplied, is called with the fraction
	 * sent (0..1) as the bytes go out, for a progress bar — optional, and not
	 * every transport can report it (DSF over fetch cannot), so a caller that
	 * needs it must tolerate never being called.
	 */
	upload(path: string, content: Uint8Array | string, onProgress?: (fraction: number) => void): Promise<void>;
	/** Create a directory. Rejects if it already exists or the parent is missing. */
	mkdir(path: string): Promise<void>;
	/**
	 * Rename or move. Rejects rather than clobbering an existing destination
	 * unless `overwrite` is set — losing a file to a name collision should take
	 * a deliberate act, not a default.
	 */
	move(from: string, to: string, overwrite?: boolean): Promise<void>;
	/**
	 * Delete a file, or a directory when `recursive` is set. A non-empty
	 * directory rejects without it.
	 */
	remove(path: string, recursive?: boolean): Promise<void>;
}

export interface Connector extends ConnectorReads, ConnectorWrites {
	readonly status: ConnectionStatus;
	/** Open a session and emit the full model via onModelKey, key by key. */
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	// There is deliberately NO switchEndpoint: backends now differ by
	// TRANSPORT as well as address, and a transport change means a different
	// connector class — which an in-place re-point cannot express. The dev
	// toggle persists the choice and reloads, so a half-switched connector has
	// no representation (design D9/C14).
}

/** Wrong password at connect. */
export class InvalidPasswordError extends Error {
	constructor() { super("Invalid password"); this.name = "InvalidPasswordError"; }
}

/** The board has no free sessions (RRF allows very few). */
export class NoFreeSessionError extends Error {
	constructor() { super("No free session on the board"); this.name = "NoFreeSessionError"; }
}

export class FileNotFoundError extends Error {
	constructor(path: string) { super(`File not found: ${path}`); this.name = "FileNotFoundError"; }
}

/** A request failed for good after retries. */
export class OperationFailedError extends Error {
	constructor(detail: string) { super(detail); this.name = "OperationFailedError"; }
}

export class DisconnectedError extends Error {
	constructor() { super("Not connected"); this.name = "DisconnectedError"; }
}
