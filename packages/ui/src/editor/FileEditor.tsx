import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";
import { useApp } from "../shell/context.ts";
import { languageFor, type EditorLang } from "./lang.ts";
import type { EditorHandle } from "./setup.ts";
import { machineStoreFor } from "../config/machineStore.ts";
import { createDraftSessionHandle } from "./draftSession.ts";
import {
	beginSession,
	checkpoint,
	closeSession,
	currentText,
	isDirty,
	isStale,
	loadSession,
	markSaved,
	saveSession,
	stepTo,
	type EditSession,
} from "./drafts.ts";

type Status = "loading" | "ready" | "saving" | "error";

/** How often the live text is folded into the checkpoint history. */
const CHECKPOINT_MS = 10_000;

/**
 * Editing surface for a single file. CodeMirror 6 is dynamically imported the
 * first time this mounts, so the editor bundle never touches the initial load.
 * Save uploads to the connected board (rr_upload, CRC32-verified); revert
 * re-reads the on-disk copy. Loads are generation-guarded so fast selection
 * changes can't leave a stale editor mounted.
 *
 * @invariant a-superseded-load-never-mounts
 * @rung 5  a closure-private counter, bumped at entry and re-checked after
 *          EVERY await — which is two sites today, the success path and the
 *          catch, both correct by inspection. That repetition is the tripwire:
 *          a third await added inside load() is a stale editor, and nothing
 *          fails until someone clicks quickly
 * @why the two awaits are a dynamic import and a board download, and the board
 *      is slow enough that clicking a second file before the first arrives is
 *      ordinary use, not a stress test. Losing the race mounts the PREVIOUS
 *      file's contents under the NEW file's title — and this editor's Save
 *      uploads to the path in the title, so the operator would overwrite one
 *      config file with another and the UI would show it as success
 * @debt promote by making the guard the thing that resumes rather than a
 *       value to remember to compare — a helper that takes the promise and
 *       resolves only for the current generation, so an unchecked await has
 *       no way to reach the mount. Rung 6, and it removes the second site.
 *
 * `lang` forces the highlight mode; without it the extension decides. Macros are
 * often extensionless on RRF, so callers that know the domain (macros, sys)
 * pass "gcode" rather than falling back to plain text.
 *
 * Content-only body (the compose conversion): Revert/Save/Close moved from the
 * old Panel header into the .editor-bar row here, because they read the
 * editor's own state (dirty/status), which a registry's static actions closure
 * cannot. The card's dynamic title (the file path) comes from the def.
 *
 * ## The text outlives this component
 *
 * CodeMirror is now a VIEW of an edit session (editor/drafts.ts), not the owner
 * of the text. The view is destroyed whenever the open path changes or the card
 * unmounts — which happens on every navigation — so anything held only inside
 * it was being thrown away, including the in-progress text and CodeMirror's own
 * undo stack. The session survives both, and a reload.
 *
 * Every route by which live text leaves the view goes through `capture()`: the
 * 10s tick, stepping, saving, reverting, switching files, and unmounting. That
 * is one place rather than six, so there is no exit from this component through
 * which the last few seconds of typing can escape unrecorded — and because a
 * session carries its own path, flushing on the way OUT of a file files the
 * text under that file even though `props.path` has already changed.
 */
export function FileEditorBody(props: {
	path: string;
	lang?: EditorLang;
	onClose?: () => void;
}) {
	const app = useApp();
	let host!: HTMLDivElement;
	let handle: EditorHandle | null = null;
	let generation = 0;

	// Bound once per session (at load/begin time), never re-resolved fresh at
	// a write site — see editor/draftSession.ts's own doc comment for why: an
	// editor left open across an identity change must not flush the OUTGOING
	// machine's text under the INCOMING machine's `drafts` key. Identity can
	// still be unknown when this card first mounts (App.tsx wires the
	// connector before the first poll resolves it); while unbound there is
	// nothing to attribute a draft to, so persistence is skipped rather than
	// guessed at — the in-memory session still works for this mount, it just
	// won't survive a reload until a machine is known (draftSession.rebind's
	// "bound" case starts persisting the moment one is).
	const draftSession = createDraftSessionHandle();

	const [dirty, setDirty] = createSignal(false);
	const [status, setStatus] = createSignal<Status>("loading");
	const [message, setMessage] = createSignal("");
	// The open file's session. Drives the ◀ ▶ readout, and is what actually
	// holds the text between mounts.
	const [session, setSession] = createSignal<EditSession | null>(null);
	// Said once when something happened to the text that the operator did not
	// do in this view — a draft came back, or the board's copy moved under it.
	const [notice, setNotice] = createSignal("");

	/**
	 * Fold whatever the view currently holds into the session, and persist.
	 *
	 * THE one place live text enters the history. Called before anything that
	 * reads or replaces the document so a step, save or navigation can never
	 * silently drop the seconds since the last tick. A no-op when the text has
	 * not changed, so idle ticks cost nothing and never pad the history.
	 */
	const capture = (): EditSession | null => untrack(() => {
		const held = session();
		if (held === null || handle === null) return held;
		const next = checkpoint(held, handle.getDoc());
		if (next === held) return held;
		setSession(next);
		// No machine identified yet: nothing to persist against, and nothing to
		// warn about — this is a transient boot-time state, not a capacity
		// problem, so the "too large" notice stays reserved for an actual
		// saveSession failure. `draftSession.store`, never a fresh resolve — see
		// its own doc comment for why a write must go through whatever this
		// SESSION was bound to, not whatever machine happens to be current now.
		const store = draftSession.store;
		if (store !== null && !saveSession(store, next)) {
			setNotice("This file is too large to keep a draft of — your edits will be lost on reload.");
		}
		return next;
	});

	const load = async (path: string): Promise<void> => {
		const gen = ++generation;
		// Flush the OUTGOING file first: switching files is a navigation away
		// from it, not a discard of it. Safe despite props.path having already
		// changed, because the session being captured carries its own path.
		capture();
		setStatus("loading");
		setMessage("");
		setNotice("");
		handle?.destroy();
		handle = null;
		try {
			const [mod, text] = await Promise.all([import("./setup.ts"), app.connector.download(path)]);
			if (gen !== generation) return; // superseded by a newer load
			// (Re)bind to whichever machine is current RIGHT NOW — this is a NEW
			// session beginning, so it is the one legitimate place to re-resolve
			// identity rather than trust whatever draftSession was left bound to.
			// A rebind to a genuinely different machine only reaches here via
			// dropSession's forced reload below, by which point the old session is
			// already gone — never a live merge of two machines' drafts.
			draftSession.rebind(machineStoreFor(app.machineId()));
			const store = draftSession.store;
			const stored = store === null ? null : loadSession(store, path);
			const active = stored ?? beginSession(path, text);
			// A draft is never discarded for having gone stale — it is the
			// operator's work, and they are the only one who gets to drop it. But
			// saving it would overwrite whatever arrived on the board in the
			// meantime, so that is stated rather than left to be discovered.
			if (stored !== null && isStale(stored, text)) {
				setNotice("This file changed on the board since you edited it — saving replaces that copy.");
			} else if (stored !== null && isDirty(stored)) {
				setNotice("Restored your unsaved edits.");
			}
			setSession(active);
			host.replaceChildren();
			handle = mod.createEditor(host, {
				doc: currentText(active),
				baseline: active.baseline,
				lang: props.lang ?? languageFor(path),
				onDirty: setDirty,
			});
			setDirty(isDirty(active));
			setStatus("ready");
		} catch (err) {
			if (gen !== generation) return;
			setMessage(errText(err));
			setStatus("error");
		}
	};

	/**
	 * Load when the connection is READY, not on mount.
	 *
	 * A remembered selection now puts this editor on screen at BOOT, and mounting
	 * races rr_connect: the download goes out before the session exists, comes
	 * back 401, and the editor latches into "Invalid password" for a request
	 * merely sent too early. Observed exactly that way in Edge after a reload,
	 * and it is the same trap the height-map store documents — a request is only
	 * meaningful once there is a session to make it under.
	 *
	 * Clearing the marker on disconnect is what makes a reconnect re-load rather
	 * than sit on a failed one. `capture()` untracks, so writing a session here
	 * cannot feed back into this effect and reload the file on every tick.
	 */
	let loadedPath: string | null = null;
	const connected = (): boolean => app.om.connection.status === "connected";
	createEffect(() => {
		const path = props.path;
		if (!connected()) {
			loadedPath = null;
			return;
		}
		if (loadedPath === path) return;
		loadedPath = path;
		void load(path);
	});

	/**
	 * Drop the in-memory session on an identity SWAP (draftSession.rebind
	 * returning "swapped" — see its own doc comment). No flush, no persist:
	 * unlike the console log this has no display-continuity argument, so
	 * there is nothing to write anywhere before discarding it, matching
	 * config/store.ts's hydrateMachine — "an edit made against a machine that
	 * is no longer current has no machine to belong to."
	 *
	 * The effect above only re-runs `load` on a PATH or CONNECTED change —
	 * neither happens on a same-path identity swap — so this drives the
	 * reload directly rather than rely on that effect to notice. `load`
	 * itself is generation-guarded, so a same-tick race with that effect
	 * (a swap that happens to coincide with a reconnect) is at worst one
	 * extra superseded download, never two sessions mounted at once.
	 */
	const dropSession = (): void => {
		handle?.destroy();
		handle = null;
		setSession(null);
		setDirty(false);
		setNotice("");
		setMessage("");
		setStatus("loading");
		if (connected()) {
			loadedPath = props.path;
			void load(props.path);
		} else {
			loadedPath = null; // next reconnect's effect run will (re)load
		}
	};

	createEffect(() => {
		if (draftSession.rebind(machineStoreFor(app.machineId())) === "swapped") dropSession();
	});

	const ticker = setInterval(capture, CHECKPOINT_MS);
	onCleanup(() => {
		clearInterval(ticker);
		capture(); // before destroy(): the view is where the live text still is
		handle?.destroy();
	});

	const save = async (): Promise<void> => {
		if (handle === null || status() === "saving") return;
		const held = capture();
		if (held === null) return;
		setStatus("saving");
		setMessage("");
		try {
			const text = handle.getDoc();
			await app.connector.upload(props.path, text);
			// Saving moves the BASELINE and keeps the history: you can still step
			// back past a save. Only Close erases a session.
			const next = markSaved(held, text);
			setSession(next);
			const store = draftSession.store;
			if (store !== null) saveSession(store, next);
			handle.setDoc(text); // new clean baseline in the view
			setStatus("ready");
			setMessage("Saved");
			setNotice("");
		} catch (err) {
			setMessage(errText(err));
			setStatus("error");
		}
	};

	const revert = async (): Promise<void> => {
		if (handle === null) return;
		const held = capture();
		if (held === null) return;
		try {
			const text = await app.connector.download(props.path);
			// The board's copy is by definition clean, and the text being
			// abandoned is checkpointed on the way past — so a mis-clicked Revert
			// is one ◀ away from being undone.
			const next = markSaved(held, text);
			setSession(next);
			const store = draftSession.store;
			if (store !== null) saveSession(store, next);
			handle.setDoc(text);
			setMessage("Reverted to the saved copy");
			setNotice("");
		} catch (err) {
			setMessage(errText(err));
		}
	};

	/**
	 * Closing is THE flush. Nothing on the save path reaches this, which is what
	 * makes "history survives a save, not a close" structural.
	 */
	const close = (): void => {
		const store = draftSession.store;
		if (store !== null) closeSession(store, props.path);
		setSession(null);
		props.onClose?.();
	};

	const step = (delta: number): void => {
		const held = capture();
		if (held === null || handle === null) return;
		const next = stepTo(held, held.at + delta);
		if (next === held) return;
		setSession(next);
		const store = draftSession.store;
		if (store !== null) saveSession(store, next);
		handle.replaceDoc(currentText(next));
		setMessage("");
	};

	const at = (): number => session()?.at ?? 0;
	const count = (): number => session()?.entries.length ?? 1;
	const canStepBack = (): boolean => session() !== null && at() > 0;
	const canStepForward = (): boolean => session() !== null && at() < count() - 1;

	return (
		<>
			<div class="editor-bar">
				{/* Always rendered, both ends included: a control that appears only
				    once there is history would move Revert/Save/Close sideways the
				    first time the tick fires, under a pointer already aimed at them. */}
				<div class="editor-steps">
					<button
						class="btn step"
						title="Step back through this session's checkpoints (taken every 10s while editing)"
						aria-label="Step back through edit checkpoints"
						disabled={!canStepBack()}
						onClick={() => step(-1)}
					>
						◀
					</button>
					<span class="editor-step-count">{at() + 1} of {count()}</span>
					<button
						class="btn step"
						title="Step forward through this session's checkpoints"
						aria-label="Step forward through edit checkpoints"
						disabled={!canStepForward()}
						onClick={() => step(1)}
					>
						▶
					</button>
				</div>
				<Show when={dirty()}>
					<span class="editor-dirty">unsaved</span>
				</Show>
				<Show
					when={notice() !== ""}
					fallback={
						<Show when={message() !== "" && !dirty()}>
							<span class="editor-msg" classList={{ err: status() === "error" }}>{message()}</span>
						</Show>
					}
				>
					<span class="editor-msg warn">{notice()}</span>
				</Show>
				<button class="btn" onClick={() => void revert()} disabled={!dirty()}>Revert</button>
				<button class="btn primary" onClick={() => void save()} disabled={!dirty() || status() === "saving"}>
					{status() === "saving" ? "Saving…" : "Save"}
				</button>
				<Show when={props.onClose}>
					<button class="btn" title="Close this file and discard its checkpoint history" onClick={close}>Close</button>
				</Show>
			</div>
			{/* Opts into edge-scroll, on the HOST rather than the scroller:
			    CodeMirror creates .cm-scroller itself, so no JSX can mark it.
			    See shell/edgeScroll.ts. */}
			<div class="editor-host" data-edge-scroll-host>
				<div class="editor-mount" ref={host} />
				<Show when={status() === "loading"}>
					<div class="editor-overlay">Loading editor…</div>
				</Show>
				<Show when={status() === "error"}>
					<div class="editor-overlay err">{message()}</div>
				</Show>
			</div>
		</>
	);
}

function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
