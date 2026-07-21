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
 */
import { createMemo, createSignal, type Accessor } from "solid-js";
import type { Connector } from "../connector/types.ts";
import type { OpResult } from "../files/browser.ts";
import { parseHeightMap, serializeHeightMap, type HeightMap } from "./parse.ts";

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
	loading: Accessor<boolean>;
	error: Accessor<string>;
	pending: Accessor<Map<string, PendingEdit>>;
	dirty: Accessor<boolean>;
	valueAt(row: number, col: number): number;
	load(): Promise<void>;
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

	const dirty = createMemo(() => pending().size > 0);

	const valueAt = (row: number, col: number): number => {
		const edit = pending().get(key(row, col));
		if (edit !== undefined) return edit.to;
		return map()?.rows[row]?.[col] ?? 0;
	};

	const load = async (): Promise<void> => {
		setLoading(true);
		setError("");
		try {
			const parsed = parseHeightMap(await connector.download(HEIGHTMAP_FILE));
			if (parsed === null) {
				setError(`${HEIGHTMAP_FILE} is not a height map this build understands.`);
				setMap(null);
			} else {
				setMap(parsed);
				setPending(new Map());
			}
		} catch (err) {
			setError(reasonOf(err));
			setMap(null);
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

	const discard = (): void => setPending(new Map());

	const save = async (): Promise<OpResult> => {
		const current = map();
		if (current === null) return { ok: false, error: "Nothing loaded." };
		// Build the edited grid without mutating the loaded map: if the write
		// fails, the operator must be exactly where they were.
		const rows = current.rows.map((r, row) => r.map((_, col) => valueAt(row, col)));
		const edited: HeightMap = { ...current, rows };
		try {
			await connector.upload(HEIGHTMAP_FILE, serializeHeightMap(edited));
			// Only now: the file on the card and the machine's live map must not be
			// able to diverge.
			await connector.sendCode("G29 S1");
		} catch (err) {
			return { ok: false, error: reasonOf(err) };
		}
		setMap(edited);
		setPending(new Map());
		return { ok: true };
	};

	return { map, loading, error, pending, dirty, valueAt, load, edit, discard, save };
}
