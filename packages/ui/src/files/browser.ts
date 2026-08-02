/**
 * The one file-browser primitive. Jobs, Macros and System each own their own
 * listing (no central Files section) but they are the SAME browser pointed at
 * different roots — so navigation and file operations exist once, not three
 * times, and cannot drift apart.
 *
 * Mutations go through `app.connector`, which in dev is the write-guarded
 * connector — so the real board still fails closed unless writes are armed.
 * That guard is deliberately NOT re-implemented here.
 *
 * (A typed name cannot escape its directory either — but that invariant is
 * `files/path-escape`, declared where its mechanism lives, in ./path.ts.)
 *
 * @invariant listing-follows-mutation
 * @rung 6  choke-point — the five mutating effects live in ONE table
 *          (MUTATIONS) and withRefresh is MAPPED over it, so an entry added
 *          there is wrapped on the way out rather than by whoever remembers.
 *          The mapped Refreshed<T> carries each signature through. Promoted
 *          2026-08-01, which is also when the table finally came to exist
 * @why a listing that disagrees with the board is worse than no listing: the
 *      operator deletes what they believe is there and hits a file that is not,
 *      or re-uploads over something they think they removed
 * @debt the table is the only route in PRACTICE — a sixth operation could
 *       still be added straight to the returned object, bypassing both the
 *       table and the map, which is exactly what rung 6 admits. Rung 7 is
 *       having FileBrowser's mutating members typed as Refreshed<...> of the
 *       table itself, so an unwrapped member does not satisfy the interface.
 *       HISTORY: this was declared rung 7 on the strength of this module's own
 *       header, which described "a MAP over the operation table". `git log -S`
 *       said no such table had ever existed — the comment described a design
 *       that was never built, and the sweep promoted that aspiration to a
 *       mechanism claim. It exists now.
 */
import { createEffect, createMemo, createResource, createSignal, type Accessor } from "solid-js";
import { FileNotFoundError, type Connector, type FileListEntry } from "../connector/types.ts";
import { childPath, dirUnderRoot, parentDir, parseFileName } from "./path.ts";
import { loadBrowserMemory, saveBrowserDir } from "./browserMemory.ts";
import { protectedReason } from "./safety.ts";

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
	/**
	 * Upload a file's bytes into the current directory under `rawName`. Overwrites
	 * a same-named file (the re-slice-and-reupload workflow); the name is parsed
	 * through the same `resolve`, so it cannot escape the directory. `onProgress`
	 * reports the fraction sent (0..1) for a progress bar.
	 */
	upload(rawName: string, content: Uint8Array, onProgress?: (fraction: number) => void): Promise<OpResult>;
	/** Rename an entry in place (same directory). */
	rename(entry: FileListEntry, rawName: string): Promise<OpResult>;
	/**
	 * Inspect what deleting `entry` would actually destroy. A directory is
	 * listed first so its contents can be counted and shown; this is the only
	 * way to obtain the RemovePlan that `remove` requires.
	 */
	planRemove(entry: FileListEntry): Promise<RemovePlan>;
	/**
	 * Carry out a planned delete. `typedName` is required only when the plan
	 * says so, and must match the file's name.
	 */
	remove(plan: RemovePlan, typedName?: string): Promise<OpResult>;
}

/**
 * A checked intent to delete something, describing what would be lost.
 *
 * @invariant delete-warning-matches-action
 * @rung 7  sole-constructor type — `remove` accepts only a branded RemovePlan,
 *          never a bare entry, and `recursive` is DERIVED here rather than
 *          passed in. A hand-built plan is a compile error
 * @why the count the operator is shown and the flag sent to the board come from
 *      one object, so "delete 1 item?" cannot precede a recursive wipe of
 *      forty. A recursive delete cannot even be issued without having first
 *      listed the directory and learned what is inside it
 */
export interface RemovePlan {
	readonly path: string;
	readonly name: string;
	/** Directories delete recursively; this is derived here, never passed in. */
	readonly recursive: boolean;
	/** Items inside a directory (0 for a file or an empty directory). */
	readonly itemCount: number;
	/** Set when the file's loss is unrecoverable — the name must be typed back. */
	readonly protectedReason: string | null;
	readonly __plan: unique symbol;
}

export function createFileBrowser(
	root: string,
	connected: Accessor<boolean>,
	connector: Connector,
	sort: FileSort = "name",
): FileBrowser {
	// Seed from the remembered directory (restored from localStorage across
	// navigations/reloads), reconstructed as a proven descendant of root — an
	// untrusted stored value can never point the browser outside its domain.
	const [dir, setDir] = createSignal(dirUnderRoot(root, loadBrowserMemory(root).dir));

	const [raw, { refetch }] = createResource(
		() => (connected() ? dir() : false),
		d => connector.list(d as string),
	);

	// Remember the directory as it changes; on a return visit the browser opens
	// where it was left.
	createEffect(() => saveBrowserDir(root, dir()));

	// A remembered directory that no longer exists (deleted between sessions)
	// answers the listing with FileNotFoundError — fall back to root rather than
	// stranding the browser on a dead directory. Only that specific error, and
	// only when not already at root, so a transient failure at root can't loop.
	createEffect(() => {
		if (raw.error instanceof FileNotFoundError && dir() !== root) setDir(root);
	});

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
	/** A raw effect, once withRefresh has given it a refresh and an OpResult. */
	type Refreshed<T> = T extends (...args: infer A) => Promise<void>
		? (...args: A) => Promise<OpResult>
		: never;

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

	const planRemove = async (entry: FileListEntry): Promise<RemovePlan> => {
		const path = pathOf(entry);
		// Count a directory's contents before offering to delete it. A failed
		// listing counts as "unknown, assume it has contents" rather than as
		// empty — guessing low here is how a silent recursive wipe happens.
		let itemCount = 0;
		if (entry.type === "d") {
			try {
				itemCount = (await connector.list(path)).length;
			} catch {
				itemCount = -1;
			}
		}
		return {
			path,
			name: entry.name,
			recursive: entry.type === "d",
			itemCount,
			protectedReason: protectedReason(path),
			// The brand exists only in the type system; nothing reads it.
		} as RemovePlan;
	};

	/**
	 * Every operation that CHANGES the board, as raw effects — no refresh, no
	 * error handling. That is the table the rung-7 wording always described and
	 * which, until 2026-08-01, did not exist: the five were each wrapped by hand
	 * at their own definition, and a sixth could simply not be.
	 *
	 * `remove` joins below, after planRemove it depends on.
	 */
	const MUTATIONS = {
		createDir: named(path => connector.mkdir(path)),
		createFile: named(path => connector.upload(path, "")),
		upload: async (rawName: string, content: Uint8Array, onProgress?: (fraction: number) => void) => {
			const r = resolve(rawName);
			if ("error" in r) throw new Error(r.error);
			await connector.upload(r.path, content, onProgress);
		},
		rename: async (entry: FileListEntry, rawName: string) => {
			const r = resolve(rawName);
			if ("error" in r) throw new Error(r.error);
			if (r.path === pathOf(entry)) return; // renaming to itself is a no-op, not an error
			await connector.move(pathOf(entry), r.path);
		},

		remove: async (plan: RemovePlan, typedName?: string) => {
			if (plan.protectedReason !== null && typedName?.trim() !== plan.name) {
				throw new Error(`Type "${plan.name}" to confirm deleting it.`);
			}
			await connector.remove(plan.path, plan.recursive);
		},
	};

	/**
	 * withRefresh MAPPED over the table, so an entry added to MUTATIONS is
	 * wrapped on the way out rather than by whoever remembers. The mapped type
	 * carries each operation's own signature through — same shape as
	 * control/commands.ts's GcodeBuilders.
	 */
	const ops = Object.fromEntries(
		Object.entries(MUTATIONS).map(([name, op]) => [name, withRefresh(op as (...a: unknown[]) => Promise<void>)]),
	) as { [K in keyof typeof MUTATIONS]: Refreshed<typeof MUTATIONS[K]> };

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
		planRemove,
		// Spread from the mapped table: every mutating operation reaches the
		// caller having been through withRefresh, by construction.
		...ops,
	};
}
