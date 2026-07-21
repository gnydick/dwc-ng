import { For, Show, createSignal, type JSX } from "solid-js";
import type { FileListEntry } from "../connector/types.ts";
import type { FileBrowser, OpResult } from "./browser.ts";
import { parseFileName } from "./path.ts";

/**
 * The single rendering of a domain file listing — breadcrumbs, create/rename/
 * delete, and the rows themselves. Jobs, Macros and System all render THIS;
 * they differ only in the root they browse and the extra per-row action they
 * contribute (Macros' ▶ Run), passed as `rowActions`.
 *
 * Consequence by construction: a file operation added here appears in every
 * domain at once, and cannot be present in one listing and missing from
 * another. Clicking a name always OPENS it — running is never a click target
 * (project rule: files never run on click).
 *
 * Layout note: every control reserves its width, and the message line reserves
 * its height, so arming a delete or surfacing an error never moves a row that
 * the operator is aiming at.
 */
function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

export function FileBrowserView(props: {
	browser: FileBrowser;
	/** Absolute path currently open in the editor, if any. */
	selected: string | null;
	onOpen: (entry: FileListEntry) => void;
	/** Label for the root crumb, e.g. "gcodes". */
	rootLabel: string;
	emptyText: string;
	/** Show each file's size and date (job listings; not useful for macros). */
	showMeta?: boolean;
	/** Domain-specific extra action rendered at the end of a FILE row (never a directory). */
	rowActions?: (entry: FileListEntry) => JSX.Element;
}) {
	// Which single row is mid-rename, and which is armed for delete. Held as
	// paths (not entries) so a refreshed listing can't leave them pointing at a
	// stale object.
	const [renaming, setRenaming] = createSignal<string | null>(null);
	const [renameText, setRenameText] = createSignal("");
	const [armed, setArmed] = createSignal<string | null>(null);
	const [creating, setCreating] = createSignal<"dir" | "file" | null>(null);
	const [createText, setCreateText] = createSignal("");
	const [message, setMessage] = createSignal("");

	/** Clear transient row state — any listing change invalidates all of it. */
	const resetRowState = (): void => {
		setRenaming(null);
		setArmed(null);
		setCreating(null);
		setCreateText("");
		setMessage("");
	};

	const report = (result: OpResult): void => {
		setMessage(result.ok ? "" : result.error);
	};

	/** A name the operator is typing is only submittable once it could be a real name. */
	const nameUsable = (raw: string): boolean => parseFileName(raw) !== null;

	const submitCreate = async (): Promise<void> => {
		const kind = creating();
		if (kind === null || !nameUsable(createText())) return;
		const result = kind === "dir"
			? await props.browser.createDir(createText())
			: await props.browser.createFile(createText());
		if (result.ok) {
			setCreating(null);
			setCreateText("");
			setMessage("");
		} else {
			report(result);
		}
	};

	const submitRename = async (entry: FileListEntry): Promise<void> => {
		if (!nameUsable(renameText())) return;
		const result = await props.browser.rename(entry, renameText());
		if (result.ok) setRenaming(null);
		report(result);
	};

	const confirmDelete = async (entry: FileListEntry): Promise<void> => {
		const path = props.browser.pathOf(entry);
		if (armed() !== path) {
			setArmed(path);
			return;
		}
		setArmed(null);
		report(await props.browser.remove(entry));
	};

	const startRename = (entry: FileListEntry): void => {
		setArmed(null);
		setMessage("");
		setRenameText(entry.name);
		setRenaming(props.browser.pathOf(entry));
	};

	const navigate = (path: string): void => {
		resetRowState();
		props.browser.goTo(path);
	};

	return (
		<div class="fb">
			<div class="crumbs">
				<button
					class="crumb"
					classList={{ active: props.browser.crumbs().length === 0 }}
					onClick={() => navigate(props.browser.root)}
				>
					{props.rootLabel}
				</button>
				<For each={props.browser.crumbs()}>
					{(crumb, i) => (
						<>
							<span class="crumb-sep">/</span>
							<button
								class="crumb"
								classList={{ active: i() === props.browser.crumbs().length - 1 }}
								onClick={() => navigate(crumb.path)}
							>
								{crumb.name}
							</button>
						</>
					)}
				</For>
			</div>

			<div class="fb-tools">
				<Show
					when={creating() !== null}
					fallback={
						<>
							<button class="fb-tool" onClick={() => { resetRowState(); setCreating("dir"); }}>+ Folder</button>
							<button class="fb-tool" onClick={() => { resetRowState(); setCreating("file"); }}>+ File</button>
						</>
					}
				>
					<input
						class="fb-input"
						autofocus
						placeholder={creating() === "dir" ? "folder name" : "file name"}
						value={createText()}
						onInput={e => setCreateText(e.currentTarget.value)}
						onKeyDown={e => {
							if (e.key === "Enter") void submitCreate();
							if (e.key === "Escape") { setCreating(null); setCreateText(""); }
						}}
					/>
					<button class="fb-tool ok" disabled={!nameUsable(createText())} onClick={() => void submitCreate()}>
						Create
					</button>
					<button class="fb-tool" onClick={() => { setCreating(null); setCreateText(""); }}>Cancel</button>
				</Show>
			</div>

			{/* Always present so surfacing an error never shifts the rows below it. */}
			<p class="fb-msg" classList={{ show: message() !== "" }}>{message() || " "}</p>

			<ul class="file-list">
				<For each={props.browser.entries()} fallback={<li class="job-empty">{props.emptyText}</li>}>
					{entry => (
						<li class="file-row" classList={{ active: props.selected === props.browser.pathOf(entry) }}>
							<Show
								when={renaming() === props.browser.pathOf(entry)}
								fallback={
									<>
										<button
											class="file-name"
											classList={{ "is-dir": entry.type === "d" }}
											onClick={() => entry.type === "d" ? navigate(props.browser.pathOf(entry)) : props.onOpen(entry)}
										>
											<Show when={entry.type === "d"}><span class="file-ico">▸</span></Show>
											{entry.name}
										</button>
										<Show when={props.showMeta && entry.type === "f"}>
											<span class="file-meta">{formatSize(entry.size)}</span>
											<span class="file-meta file-date">{entry.date ? entry.date.slice(0, 10) : ""}</span>
										</Show>
										{/* Files only. A directory is a place to navigate to, never the
										    target of a domain action — rendering Macros' ▶ Run on a folder
										    would offer to M98 a directory. Enforced here rather than in each
										    caller so no domain can reintroduce it. */}
										<Show when={entry.type === "f"}>{props.rowActions?.(entry)}</Show>
										<button class="fb-act" title={`Rename ${entry.name}`} onClick={() => startRename(entry)}>Rename</button>
										<button
											class="fb-act danger"
											classList={{ armed: armed() === props.browser.pathOf(entry) }}
											title={entry.type === "d" ? `Delete ${entry.name} and its contents` : `Delete ${entry.name}`}
											onClick={() => void confirmDelete(entry)}
										>
											{armed() === props.browser.pathOf(entry) ? "Confirm" : "Delete"}
										</button>
									</>
								}
							>
								<input
									class="fb-input grow"
									autofocus
									value={renameText()}
									onInput={e => setRenameText(e.currentTarget.value)}
									onKeyDown={e => {
										if (e.key === "Enter") void submitRename(entry);
										if (e.key === "Escape") setRenaming(null);
									}}
								/>
								<button class="fb-act ok" disabled={!nameUsable(renameText())} onClick={() => void submitRename(entry)}>Save</button>
								<button class="fb-act" onClick={() => setRenaming(null)}>Cancel</button>
							</Show>
						</li>
					)}
				</For>
			</ul>
		</div>
	);
}
