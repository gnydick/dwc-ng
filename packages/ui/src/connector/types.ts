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
	/** A G-code reply / console message arrived. */
	onReply?(text: string): void;
	onStatusChange?(status: ConnectionStatus, detail?: string): void;
	/** Files changed on the given volume (SD card index). */
	onFilesChanged?(volume: number): void;
	/**
	 * Board facts learned at connect time. `emulated` is true when the rr_ API
	 * is served by DSF on an SBC (rr_connect isEmulated) rather than by a
	 * standalone board's own firmware.
	 */
	onBoardInfo?(info: { emulated: boolean; boardType?: string }): void;
}

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
 * The write half: everything that can change the machine or its SD card.
 * The dev write guard fails ALL of this closed on the real board unless
 * writes are armed (sendCode's e-stop pass-through is the one documented
 * exception).
 */
export interface ConnectorWrites {
	/** Execute a G/M/T-code; resolves with its reply text ("" if none came). */
	sendCode(code: string): Promise<string>;
	/**
	 * Upload a file (verified end-to-end by the transport, e.g. CRC32).
	 * `onProgress`, when supplied, is called with the fraction sent (0..1) as the
	 * bytes go out, for a progress bar. Optional — not every transport can report
	 * progress, and a caller that doesn't need it passes nothing.
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
	/**
	 * Dev-only: repoint the connector at a different backend (Mock vs the real
	 * board, via the dev proxy). Optional — not every transport supports it.
	 */
	switchEndpoint?(baseUrl: string, password: string): Promise<void>;
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
