/**
 * The one file-browser primitive. Jobs, Macros and System each own their own
 * listing (no central Files section) but they are the SAME browser pointed at
 * different roots — so navigation and file operations exist once, not three
 * times, and cannot drift apart.
 *
 * Two invariants are structural here:
 *
 *  - **The listing matches the board after any mutation.** Every operation is
 *    built by mapping a raw implementation through `withRefresh` (see OPS
 *    below). A future operation added to that table gets the refetch applied by
 *    the map, not by whoever writes it — there is no version of the function
 *    that could forget.
 *  - **A typed name cannot escape its directory.** Paths are built only by
 *    `childPath`, which accepts only a parsed `FileName` (see ./path.ts).
 *
 * Mutations go through `app.connector`, which in dev is the write-guarded
 * connector — so the real board still fails closed unless writes are armed.
 * That guard is deliberately NOT re-implemented here.
 */
import { createMemo, createResource, createSignal, type Accessor } from "solid-js";
import type { Connector, FileListEntry } from "../connector/types.ts";
import { childPath, parentDir, parseFileName } from "./path.ts";

/** Outcome of a file operation, in a form the UI can render directly. */
export type OpResult = { ok: true } | { ok: false; error: string };

/**
 * How files are ordered within a listing. Directories always sort first
 * regardless — only the files are affected.
 *
 * "recent" is how you actually hunt for a job you just sliced; "name" is how
 * you look for a macro or a config file you already know the name of.
 */
export type FileSort = "name" | "recent";

const failed = (error: string): OpResult => ({ ok: false, error });

/** Message from a rejected operation, including the dev write-guard's. */
function reasonOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export interface FileBrowser {
	/** The domain root this browser is pinned to; navigation never goes above it. */
	readonly root: string;
	/** Directory currently being listed. */
	dir: Accessor<string>;
	/** Entries of `dir`, directories first then case-insensitive by name. */
	entries: Accessor<FileListEntry[]>;
	/** True while a listing request is in flight. */
	loading: Accessor<boolean>;
	/** Path segments from the root to `dir`, for breadcrumb navigation. */
	crumbs: Accessor<{ name: string; path: string }[]>;
	/** Absolute path of an entry in the current directory. */
	pathOf(entry: FileListEntry): string;
	/** Descend into a directory entry. */
	enter(entry: FileListEntry): void;
	goUp(): void;
	goTo(path: string): void;
	refresh(): void;
	/** Create a directory in the current directory. */
	createDir(rawName: string): Promise<OpResult>;
	/** Create an empty file in the current directory. */
	createFile(rawName: string): Promise<OpResult>;
	/** Rename an entry in place (same directory). */
	rename(entry: FileListEntry, rawName: string): Promise<OpResult>;
	/** Delete an entry; directories are removed with their contents. */
	remove(entry: FileListEntry): Promise<OpResult>;
}

export function createFileBrowser(
	root: string,
	connected: Accessor<boolean>,
	connector: Connector,
	sort: FileSort = "name",
): FileBrowser {
	const [dir, setDir] = createSignal(root);

	const [raw, { refetch }] = createResource(
		() => (connected() ? dir() : false),
		d => connector.list(d as string),
	);

	const byName = (a: FileListEntry, b: FileListEntry): number =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

	const entries = createMemo(() =>
		[...(raw() ?? [])].sort((a, b) => {
			if (a.type !== b.type) return a.type === "d" ? -1 : 1;
			// Directories are always alphabetical — "newest folder" is not how
			// anyone navigates, and a folder's date is its own mtime, not its
			// contents'.
			if (a.type === "d" || sort === "name") return byName(a, b);
			// Undated entries sort last rather than jumbling in at the top, then
			// fall back to name so the order is total (a stable listing can't
			// depend on the transport's arbitrary order).
			const dated = (b.date ?? "").localeCompare(a.date ?? "");
			return dated !== 0 ? dated : byName(a, b);
		}),
	);

	const crumbs = createMemo(() =>
		dir()
			.slice(root.length)
			.split("/")
			.filter(Boolean)
			.map((name, i, all) => ({ name, path: `${root}/${all.slice(0, i + 1).join("/")}` })),
	);

	const pathOf = (entry: FileListEntry): string => `${dir()}/${entry.name}`;

	/**
	 * Wraps a raw operation so the listing is re-read after it succeeds. This is
	 * the choke point that keeps the UI honest: it is applied by the map that
	 * builds the public operations, so no operation can be written without it.
	 */
	const withRefresh =
		<A extends unknown[]>(op: (...args: A) => Promise<void>) =>
		async (...args: A): Promise<OpResult> => {
			try {
				await op(...args);
			} catch (err) {
				// The board is unchanged (or partially changed) — re-read either way
				// rather than trusting our guess about what failed.
				void refetch();
				return failed(reasonOf(err));
			}
			void refetch();
			return { ok: true };
		};

	/**
	 * Resolve raw input to a path in the current directory, or explain why not.
	 * Named-once so every operation rejects a bad name identically.
	 */
	const resolve = (rawName: string): { path: string } | { error: string } => {
		const name = parseFileName(rawName);
		if (name === null) {
			return { error: `"${rawName.trim()}" is not a usable name — no / \\ : * ? " < > | and no . or ..` };
		}
		return { path: childPath(dir(), name) };
	};

	/** Lift a name-taking operation into one that parses first and never sees a raw string. */
	const named =
		(op: (path: string) => Promise<void>) =>
		async (rawName: string): Promise<void> => {
			const r = resolve(rawName);
			if ("error" in r) throw new Error(r.error);
			await op(r.path);
		};

	const createDir = withRefresh(named(path => connector.mkdir(path)));
	const createFile = withRefresh(named(path => connector.upload(path, "")));

	const rename = withRefresh(async (entry: FileListEntry, rawName: string) => {
		const r = resolve(rawName);
		if ("error" in r) throw new Error(r.error);
		if (r.path === pathOf(entry)) return; // renaming to itself is a no-op, not an error
		await connector.move(pathOf(entry), r.path);
	});

	const remove = withRefresh(async (entry: FileListEntry) => {
		await connector.remove(pathOf(entry), entry.type === "d");
	});

	return {
		root,
		dir,
		entries,
		loading: () => raw.loading,
		crumbs,
		pathOf,
		enter: entry => {
			if (entry.type === "d") setDir(pathOf(entry));
		},
		goUp: () => setDir(parentDir(dir(), root)),
		goTo: path => setDir(path),
		refresh: () => void refetch(),
		createDir,
		createFile,
		rename,
		remove,
	};
}
