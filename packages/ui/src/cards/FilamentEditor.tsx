import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditorBody } from "../editor/FileEditor.tsx";
import { parseFileName } from "../files/path.ts";

const FILAMENTS_DIR = "0:/filaments";
/** RRF reads exactly these three per filament; config.g is optional. */
const MACROS = ["config.g", "load.g", "unload.g"] as const;
type Macro = (typeof MACROS)[number];

const dirOf = (name: string): string => `${FILAMENTS_DIR}/${name}`;
const pathOf = (name: string, macro: Macro): string => `${dirOf(name)}/${macro}`;

/**
 * Filament editor — define the materials this machine knows about.
 *
 * A filament is a DIRECTORY under 0:/filaments holding load.g / unload.g /
 * config.g. RRF has no filament model beyond those macros: M703 runs config.g,
 * and M701/M702 run load.g/unload.g. So this edits the macros as G-code rather
 * than offering a structured form that would invent semantics the firmware does
 * not have (project rule: the firmware is the authority).
 *
 * This is machine management, not a file browser — you pick a material and edit
 * what it does. Rename and delete are refused while that filament is loaded on
 * an extruder, because the name in move.extruders[].filament would then point at
 * something that no longer exists.
 */
export function FilamentEditorBody() {
	const app = useApp();

	const connected = (): boolean => app.om.connection.status === "connected";
	const [reload, setReload] = createSignal(0);
	const [filaments, { refetch }] = createResource(
		() => (connected() ? `${FILAMENTS_DIR}#${reload()}` : false),
		async () => {
			const entries = await app.connector.list(FILAMENTS_DIR);
			return entries.filter(e => e.type === "d").map(e => e.name).sort((a, b) => a.localeCompare(b));
		},
	);

	const [selected, setSelected] = createSignal<string | null>(null);

	// Open on the first filament rather than an empty pane: the editor only
	// exists for a SELECTED filament, and a card that shows a list and no editor
	// reads as "there is no editor here". This also re-homes the selection when
	// the chosen filament is renamed or deleted out from under it.
	createEffect(() => {
		const list = filaments();
		if (list === undefined || list.length === 0) return;
		const current = selected();
		if (current === null || !list.includes(current)) setSelected(list[0]!);
	});
	const [macro, setMacro] = createSignal<Macro>("config.g");
	const [creating, setCreating] = createSignal(false);
	const [renaming, setRenaming] = createSignal<string | null>(null);
	const [draft, setDraft] = createSignal("");
	const [armed, setArmed] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [message, setMessage] = createSignal("");

	/** Filaments currently loaded on some extruder — these may not be renamed or deleted. */
	const loadedNames = createMemo(() => {
		const names = new Set<string>();
		for (const e of app.om.om.move.extruders) if (e.filament !== "") names.add(e.filament);
		return names;
	});
	const isLoaded = (name: string): boolean => loadedNames().has(name);

	const reset = (): void => {
		setCreating(false);
		setRenaming(null);
		setDraft("");
		setArmed(null);
	};

	const refresh = (): void => { setReload(n => n + 1); void refetch(); };

	/** A name must be a single usable path segment — no separators, no traversal. */
	const usable = (raw: string): boolean => parseFileName(raw) !== null;

	const run = async (what: string, fn: () => Promise<void>): Promise<void> => {
		setBusy(true);
		setMessage("");
		try {
			await fn();
			refresh();
			reset();
		} catch (err) {
			setMessage(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const create = (): Promise<void> => {
		const name = parseFileName(draft());
		if (name === null) return Promise.resolve();
		return run("Create", async () => {
			await app.connector.mkdir(dirOf(name));
			// Seed all three so the editor always has a file to open; a bare comment
			// is valid G-code and says which macro you are looking at.
			for (const m of MACROS) {
				await app.connector.upload(pathOf(name, m), `; ${m} for ${name}\n`);
			}
			setSelected(name);
		});
	};

	const rename = (from: string): Promise<void> => {
		const to = parseFileName(draft());
		if (to === null || to === from) return Promise.resolve();
		return run("Rename", async () => {
			await app.connector.move(dirOf(from), dirOf(to));
			if (selected() === from) setSelected(to);
		});
	};

	const remove = (name: string): Promise<void> =>
		run("Delete", async () => {
			await app.connector.remove(dirOf(name), true);
			if (selected() === name) setSelected(null);
		});

	const duplicate = (from: string): Promise<void> => {
		const to = parseFileName(draft());
		if (to === null) return Promise.resolve();
		return run("Duplicate", async () => {
			await app.connector.mkdir(dirOf(to));
			for (const m of MACROS) {
				// config.g is optional upstream; a missing macro must not abort the copy.
				let body: string;
				try {
					body = await app.connector.download(pathOf(from, m));
				} catch {
					continue;
				}
				await app.connector.upload(pathOf(to, m), body);
			}
			setSelected(to);
		});
	};

	const [duplicating, setDuplicating] = createSignal<string | null>(null);

	return (
		<div class="fil-editor">
			<div class="fb-bar">
				<button class="fb-tool" disabled={busy()} onClick={() => { reset(); setCreating(true); }}>+ Filament</button>
				<Show when={creating()}>
					<input
						class="fb-input"
						autofocus
						placeholder="filament name"
						value={draft()}
						onInput={e => setDraft(e.currentTarget.value)}
						onKeyDown={e => { if (e.key === "Enter") void create(); if (e.key === "Escape") reset(); }}
					/>
					<button class="fb-tool ok" disabled={!usable(draft()) || busy()} onClick={() => void create()}>Create</button>
					<button class="fb-tool" onClick={reset}>Cancel</button>
				</Show>
			</div>

			{/* Always present so surfacing an error never shifts the rows below it. */}
			<p class="fb-msg" classList={{ show: message() !== "" }}>{message() || " "}</p>

			<Show
				when={(filaments() ?? []).length > 0}
				fallback={<p class="job-empty">{filaments.loading ? "Reading filaments…" : `No filaments in ${FILAMENTS_DIR}.`}</p>}
			>
				<ul class="fil-list">
					<For each={filaments() ?? []}>
						{name => (
							<li class="fil-row" classList={{ active: selected() === name }}>
								<button class="file-name" onClick={() => setSelected(selected() === name ? null : name)}>
									{name}
								</button>
								{/* A loaded filament is named by move.extruders[].filament — renaming
								    or deleting it would leave that pointing at nothing. */}
								<Show when={isLoaded(name)}>
									<span class="fil-loaded" title="Loaded on an extruder">loaded</span>
								</Show>
								<Show when={renaming() === name || duplicating() === name}>
									<input
										class="fb-input"
										autofocus
										placeholder={renaming() === name ? "new name" : "copy name"}
										value={draft()}
										onInput={e => setDraft(e.currentTarget.value)}
										onKeyDown={e => {
											if (e.key === "Enter") void (renaming() === name ? rename(name) : duplicate(name));
											if (e.key === "Escape") { reset(); setDuplicating(null); }
										}}
									/>
									<button
										class="fb-tool ok"
										disabled={!usable(draft()) || busy()}
										onClick={() => void (renaming() === name ? rename(name) : duplicate(name))}
									>
										{renaming() === name ? "Rename" : "Copy"}
									</button>
								</Show>
								<button
									class="fb-act"
									disabled={isLoaded(name) || busy()}
									title={isLoaded(name) ? "Loaded on an extruder" : `Rename ${name}`}
									onClick={() => { reset(); setDuplicating(null); setRenaming(name); }}
								>
									Rename
								</button>
								<button
									class="fb-act"
									disabled={busy()}
									title={`Duplicate ${name}`}
									onClick={() => { reset(); setRenaming(null); setDuplicating(name); }}
								>
									Duplicate
								</button>
								<button
									class="fb-act danger"
									classList={{ armed: armed() === name }}
									disabled={isLoaded(name) || busy()}
									title={isLoaded(name) ? "Loaded on an extruder" : `Delete ${name} and its macros`}
									onClick={() => (armed() === name ? void remove(name) : setArmed(name))}
									onBlur={() => setArmed(a => (a === name ? null : a))}
								>
									{armed() === name ? "Confirm" : "Delete"}
								</button>
							</li>
						)}
					</For>
				</ul>
			</Show>

			<Show when={selected()}>
				{name => (
					<div class="fil-edit">
						<div class="fil-tabs" role="group" aria-label="Filament macro">
							<For each={MACROS}>
								{m => (
									<button
										class="fb-tool"
										classList={{ ok: macro() === m }}
										onClick={() => setMacro(m)}
									>
										{m}
									</button>
								)}
							</For>
							<span class="fil-path">{pathOf(name(), macro())}</span>
						</div>
						{/* Keyed on the path so switching filament or macro rebuilds the
						    editor against the new file rather than reusing a stale buffer. */}
						<Show when={pathOf(name(), macro())} keyed>
							{path => <FileEditorBody path={path} lang="gcode" />}
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
