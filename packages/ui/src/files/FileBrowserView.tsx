import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from "solid-js";
import type { FileListEntry } from "../connector/types.ts";
import type { FileBrowser, OpResult, RemovePlan } from "./browser.ts";
import { parseFileName } from "./path.ts";
import { loadBrowserMemory, saveBrowserScroll } from "./browserMemory.ts";
import { formatModified, formatSize } from "./format.ts";

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
	// The armed delete carries its plan, so the warning shown and the request
	// sent come from the same object and cannot disagree.
	const [armed, setArmed] = createSignal<RemovePlan | null>(null);
	const [typedName, setTypedName] = createSignal("");
	const [creating, setCreating] = createSignal<"dir" | "file" | null>(null);
	const [createText, setCreateText] = createSignal("");
	const [message, setMessage] = createSignal("");
	// Upload-from-disk: the transfer in flight (drives the busy line) and the
	// drag-over highlight. One file at a time — the RRF server buckles under
	// parallel POSTs.
	const [uploading, setUploading] = createSignal<{ name: string; done: number; total: number; fraction: number } | null>(null);
	const [dragging, setDragging] = createSignal(false);
	let fileInput!: HTMLInputElement;

	// Per-directory scroll memory. The list is the scroll container; its offset
	// is saved (debounced) as the operator scrolls and restored when a
	// directory's rows have rendered, so returning to a listing lands where it
	// was left. Keyed by root + directory via browserMemory.
	let listEl: HTMLUListElement | undefined;
	let pendingRestore: number | null = loadBrowserMemory(props.browser.root).scroll[props.browser.dir()] ?? 0;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const onScroll = (): void => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			if (listEl) saveBrowserScroll(props.browser.root, props.browser.dir(), Math.round(listEl.scrollTop));
		}, 150);
	};
	onCleanup(() => clearTimeout(saveTimer));
	// A directory change queues its remembered offset; the queued restore is
	// applied once that directory's rows are in the DOM (entries() re-runs the
	// effect), and only once, so a later create/delete refresh doesn't yank the
	// list back under the operator.
	createEffect(on(() => props.browser.dir(), dir => {
		pendingRestore = loadBrowserMemory(props.browser.root).scroll[dir] ?? 0;
	}, { defer: true }));
	createEffect(() => {
		props.browser.entries(); // re-run when the listing renders
		// Wait for the real rows: while the listing loads, entries() is [] and
		// restoring onto the empty list clamps scrollTop to 0 and burns the
		// one-shot pendingRestore before the rows arrive.
		if (props.browser.loading()) return;
		if (pendingRestore !== null && listEl) {
			const top = pendingRestore;
			pendingRestore = null;
			requestAnimationFrame(() => { if (listEl) listEl.scrollTop = top; });
		}
	});

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

	/**
	 * Upload picked or dropped files into the current directory, sequentially so
	 * the weak RRF server never sees parallel POSTs. Stops at the first failure
	 * (a full disk / write error) rather than hammering on. The browser reads
	 * each file into memory — fine for gcode on a desktop/tablet.
	 */
	const uploadFiles = async (files: File[]): Promise<void> => {
		if (files.length === 0 || uploading() !== null) return;
		setMessage("");
		for (let i = 0; i < files.length; i++) {
			const file = files[i]!;
			setUploading({ name: file.name, done: i, total: files.length, fraction: 0 });
			const result = await props.browser.upload(
				file.name,
				new Uint8Array(await file.arrayBuffer()),
				fraction => setUploading(u => (u ? { ...u, fraction } : u)),
			);
			if (!result.ok) { report(result); break; }
		}
		setUploading(null);
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

	/**
	 * Arming a delete PLANS it first, so what the operator is about to lose is
	 * on screen before the second click — the item count for a directory, or a
	 * name to type back for something unrecoverable.
	 */
	const armDelete = async (entry: FileListEntry): Promise<void> => {
		setMessage("");
		setRenaming(null);
		const plan = await props.browser.planRemove(entry);
		setArmed(plan);
		setTypedName("");
	};

	const fireDelete = async (): Promise<void> => {
		const plan = armed();
		if (plan === null) return;
		const result = await props.browser.remove(plan, typedName());
		setArmed(null);
		setTypedName("");
		report(result);
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
		<div
			class="fb"
			classList={{ "fb-dragging": dragging() }}
			onDragOver={e => { e.preventDefault(); if (!dragging()) setDragging(true); }}
			onDragLeave={e => {
				// Only clear when the pointer actually leaves the browser, not when
				// it crosses onto a child element (dragleave fires for those too).
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
			}}
			onDrop={e => {
				e.preventDefault();
				setDragging(false);
				void uploadFiles([...(e.dataTransfer?.files ?? [])]);
			}}
		>
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
							<button class="fb-tool" disabled={uploading() !== null} onClick={() => fileInput.click()}>↑ Upload</button>
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
				{/* Hidden — opened by the Upload button; the multiple picker feeds
				    the same sequential uploader the drop zone does. Reset value so
				    re-picking the same file fires onChange again. */}
				<input
					ref={fileInput}
					type="file"
					multiple
					class="fb-file-input"
					onChange={e => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; void uploadFiles(files); }}
				/>
			</div>

			<Show when={uploading()}>
				{u => (
					<div class="fb-uploading">
						<span class="fb-up-label">
							Uploading <b>{u().name}</b>
							<Show when={u().total > 1}> · {u().done + 1} of {u().total}</Show>
						</span>
						<span class="fb-progress" role="progressbar" aria-valuenow={Math.round(u().fraction * 100)}>
							<span class="fb-progress-fill" style={{ width: `${Math.round(u().fraction * 100)}%` }} />
						</span>
						<span class="fb-up-pct">{Math.round(u().fraction * 100)}%</span>
					</div>
				)}
			</Show>

			{/* Always present so surfacing an error never shifts the rows below it. */}
			<p class="fb-msg" classList={{ show: message() !== "" }}>{message() || " "}</p>

			{/* What the armed delete would actually destroy - stated before the
			    second click, and read from the same plan object that will be sent,
			    so the warning cannot describe something other than the action. */}
			<Show when={armed()}>
				{plan => (
					<div class="fb-warn">
						<Show when={plan().recursive && plan().itemCount !== 0}>
							<p class="fb-warn-line">
								<Show
									when={plan().itemCount > 0}
									fallback={<>Couldn't read <b>{plan().name}</b> - it may not be empty. Deleting removes everything inside it.</>}
								>
									Deleting <b>{plan().name}</b> also deletes the <b>{plan().itemCount}</b>
									{" "}item{plan().itemCount === 1 ? "" : "s"} inside it.
								</Show>
							</p>
						</Show>
						<Show when={plan().protectedReason}>
							{reason => (
								<>
									<p class="fb-warn-line">Deleting <b>{plan().name}</b> loses {reason()}.</p>
									<label class="fb-warn-confirm">
										<span>Type <b>{plan().name}</b> to confirm</span>
										<input
											class="fb-input"
											value={typedName()}
											onInput={e => setTypedName(e.currentTarget.value)}
											onKeyDown={e => { if (e.key === "Enter") void fireDelete(); }}
										/>
									</label>
								</>
							)}
						</Show>
						<button class="fb-tool" onClick={() => { setArmed(null); setTypedName(""); }}>Cancel</button>
					</div>
				)}
			</Show>

			<ul class="file-list" ref={listEl} onScroll={onScroll}>
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
											<span class="file-meta file-date">{formatModified(entry.date)}</span>
										</Show>
										{/* Files only. A directory is a place to navigate to, never the
										    target of a domain action — rendering Macros' ▶ Run on a folder
										    would offer to M98 a directory. Enforced here rather than in each
										    caller so no domain can reintroduce it. */}
										<Show when={entry.type === "f"}>{props.rowActions?.(entry)}</Show>
										<button class="fb-act" title={`Rename ${entry.name}`} onClick={() => startRename(entry)}>Rename</button>
										<button
											class="fb-act danger"
											classList={{ armed: armed()?.path === props.browser.pathOf(entry) }}
											title={entry.type === "d" ? `Delete ${entry.name} and its contents` : `Delete ${entry.name}`}
											onClick={() =>
												armed()?.path === props.browser.pathOf(entry)
													? void fireDelete()
													: void armDelete(entry)
											}
										>
											{armed()?.path === props.browser.pathOf(entry) ? "Confirm" : "Delete"}
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
