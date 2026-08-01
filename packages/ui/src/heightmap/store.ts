/**
 * The loaded height map plus an overlay of pending edits.
 *
 * Same shape as the config store: an immutable loaded value, an overlay of
 * changes, and a discard that is just dropping the overlay — so discarding
 * cannot half-fail.
 *
 * save() uploads AND runs G29 S1. Those are one operation on purpose: RRF keeps
 * compensating with the map it loaded at boot, so uploading the file alone
 * would change the card and not the machine, and the two would silently
 * disagree. Neither half failing may report success — a failed reload leaves
 * the file on the card but the machine still on the old map, which is exactly
 * the state an operator must not be told is "saved".
 *
 * @invariant saving-a-map-changes-file-and-machine-together
 * @rung 6  choke-point — one save(), both halves inside one try, and the
 *          reload names the SAME path that was just written rather than
 *          defaulting to heightmap.csv. There is no "upload only" entry point
 *          for a caller to reach for
 * @why RRF keeps compensating with the map it loaded at BOOT. Uploading alone
 *      changes the card and not the machine, so the file the operator is
 *      looking at and the compensation actually being applied disagree with
 *      nothing on screen to say so — and the way that surfaces is a print
 *      whose first layer is wrong for reasons the map appears to rule out
 * @debt the two halves are sequenced by await, so a caller could still be
 *       written that uploads through the connector directly. Promote by making
 *       the connector's upload of a map file unreachable except through this
 *       function — a branded MapWrite the transport is the sole consumer of —
 *       so "write the file without reloading it" has no expression.
 */
import { createMemo, createSignal, type Accessor } from "solid-js";
import type { Connector } from "../connector/types.ts";
import type { OpResult } from "../files/browser.ts";
import { parseHeightMap, serializeHeightMap, type HeightMap } from "./parse.ts";
import { cmd } from "../control/commands.ts";

export const HEIGHTMAP_FILE = "0:/sys/heightmap.csv";

export interface PendingEdit {
	row: number;
	col: number;
	from: number;
	to: number;
}

const key = (row: number, col: number): string => `${row},${col}`;

export interface HeightMapStore {
	map: Accessor<HeightMap | null>;
	/** The file the loaded map came from — what save() writes back to. */
	path: Accessor<string>;
	loading: Accessor<boolean>;
	error: Accessor<string>;
	pending: Accessor<Map<string, PendingEdit>>;
	dirty: Accessor<boolean>;
	valueAt(row: number, col: number): number;
	/** Load a map. Omit the path to reload whichever file is current. */
	load(path?: string): Promise<void>;
	edit(row: number, col: number, value: number): void;
	discard(): void;
	save(): Promise<OpResult>;
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createHeightMapStore(connector: Connector): HeightMapStore {
	const [map, setMap] = createSignal<HeightMap | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");
	const [pending, setPending] = createSignal<Map<string, PendingEdit>>(new Map());
	// Which file the loaded map came from. save() writes back HERE and reloads
	// THIS file, so picking a different map can never write one file and tell
	// the machine to compensate from another.
	const [path, setPath] = createSignal(HEIGHTMAP_FILE);

	const dirty = createMemo(() => pending().size > 0);

	const valueAt = (row: number, col: number): number => {
		const edit = pending().get(key(row, col));
		if (edit !== undefined) return edit.to;
		return map()?.rows[row]?.[col] ?? 0;
	};

	const load = async (next?: string): Promise<void> => {
		const target = next ?? path();
		setLoading(true);
		setError("");
		try {
			const parsed = parseHeightMap(await connector.download(target));
			if (parsed === null) {
				setError(`${target} is not a height map this build understands.`);
				setMap(null);
			} else {
				setMap(parsed);
				setPending(new Map());
			}
			// Adopt the path either way. A file that failed to parse is still the
			// one being looked at, and leaving `path` pointing at the PREVIOUS file
			// would aim a later save at a map the operator is no longer editing.
			setPath(target);
		} catch (err) {
			setError(reasonOf(err));
			setMap(null);
			setPath(target);
		} finally {
			setLoading(false);
		}
	};

	const edit = (row: number, col: number, value: number): void => {
		const current = map();
		if (current === null) return;
		const from = current.rows[row]?.[col];
		if (from === undefined) return;
		const next = new Map(pending());
		// Editing a cell back to what it already was is not a change; leaving it
		// in the overlay would mark the map dirty with nothing to write.
		if (value === from) next.delete(key(row, col));
		else next.set(key(row, col), { row, col, from, to: value });
		setPending(next);
	};

	// Braced, not a concise arrow: setPending returns the new Map, and a
	// concise body would make this () => Map while declaring (): void.
	const discard = (): void => { setPending(new Map()); };

	const save = async (): Promise<OpResult> => {
		const current = map();
		if (current === null) return { ok: false, error: "Nothing loaded." };
		// Build the edited grid without mutating the loaded map: if the write
		// fails, the operator must be exactly where they were.
		const rows = current.rows.map((r, row) => r.map((_, col) => valueAt(row, col)));
		const edited: HeightMap = { ...current, rows };
		const target = path();
		try {
			await connector.upload(target, serializeHeightMap(edited));
			// Only now: the file on the card and the machine's live map must not be
			// able to diverge. The reload names the SAME file that was just written
			// — G29 S1 with no P would reload heightmap.csv, so editing any other
			// map would leave the machine compensating from a file we did not touch.
			// The default file still sends the BARE form: that is the exact command
			// DWC issues and the one verified on the board, and the P form is only
			// worth the risk where it changes the outcome.
			await connector.sendCode(
				cmd.loadHeightmap(target === HEIGHTMAP_FILE ? undefined : target),
			);
		} catch (err) {
			return { ok: false, error: reasonOf(err) };
		}
		setMap(edited);
		setPending(new Map());
		return { ok: true };
	};

	return { map, path, loading, error, pending, dirty, valueAt, load, edit, discard, save };
}
