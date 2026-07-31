import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useApp } from "../shell/context.ts";
import { languageFor, type EditorLang } from "./lang.ts";
import type { EditorHandle } from "./setup.ts";

type Status = "loading" | "ready" | "saving" | "error";

/**
 * Editing surface for a single file. CodeMirror 6 is dynamically imported the
 * first time this mounts, so the editor bundle never touches the initial load.
 * Save uploads to the connected board (rr_upload, CRC32-verified); revert
 * re-reads the on-disk copy. Loads are generation-guarded so fast selection
 * changes can't leave a stale editor mounted.
 *
 * `lang` forces the highlight mode; without it the extension decides. Macros are
 * often extensionless on RRF, so callers that know the domain (macros, sys)
 * pass "gcode" rather than falling back to plain text.
 *
 * Content-only body (the compose conversion): Revert/Save/Close moved from the
 * old Panel header into the .editor-bar row here, because they read the
 * editor's own state (dirty/status), which a registry's static actions closure
 * cannot. The card's dynamic title (the file path) comes from the def.
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

	const [dirty, setDirty] = createSignal(false);
	const [status, setStatus] = createSignal<Status>("loading");
	const [message, setMessage] = createSignal("");

	const load = async (path: string): Promise<void> => {
		const gen = ++generation;
		setStatus("loading");
		setMessage("");
		handle?.destroy();
		handle = null;
		try {
			const [mod, text] = await Promise.all([import("./setup.ts"), app.connector.download(path)]);
			if (gen !== generation) return; // superseded by a newer load
			host.replaceChildren();
			handle = mod.createEditor(host, { doc: text, lang: props.lang ?? languageFor(path), onDirty: setDirty });
			setDirty(false);
			setStatus("ready");
		} catch (err) {
			if (gen !== generation) return;
			setMessage(errText(err));
			setStatus("error");
		}
	};

	createEffect(() => void load(props.path));
	onCleanup(() => handle?.destroy());

	const save = async (): Promise<void> => {
		if (handle === null || status() === "saving") return;
		setStatus("saving");
		setMessage("");
		try {
			const text = handle.getDoc();
			await app.connector.upload(props.path, text);
			handle.setDoc(text); // new clean baseline
			setStatus("ready");
			setMessage("Saved");
		} catch (err) {
			setMessage(errText(err));
			setStatus("error");
		}
	};

	const revert = async (): Promise<void> => {
		if (handle === null) return;
		try {
			handle.setDoc(await app.connector.download(props.path));
			setMessage("Reverted to the saved copy");
		} catch (err) {
			setMessage(errText(err));
		}
	};

	return (
		<>
			<div class="editor-bar">
				<Show when={dirty()}>
					<span class="editor-dirty">unsaved</span>
				</Show>
				<Show when={message() !== "" && !dirty()}>
					<span class="editor-msg" classList={{ err: status() === "error" }}>{message()}</span>
				</Show>
				<button class="btn" onClick={() => void revert()} disabled={!dirty()}>Revert</button>
				<button class="btn primary" onClick={() => void save()} disabled={!dirty() || status() === "saving"}>
					{status() === "saving" ? "Saving…" : "Save"}
				</button>
				<Show when={props.onClose}>
					<button class="btn" onClick={() => props.onClose?.()}>Close</button>
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
