import { For, Show, createEffect, createSignal } from "solid-js";
import { useApp } from "./context.ts";
import { Panel } from "./Panel.tsx";
import type { PanelCanvasController } from "./panelCanvas.ts";

/**
 * Console as a regular panel — no more global docked/floating toggle.
 * Gabe's macros emit M118 messages that are the reason to run them, so the
 * history (localStorage-persisted, see om/consoleLog.ts) stays visible
 * rather than scrolling past in a one-line drawer.
 */
export function ConsolePanel(props: { canvas: PanelCanvasController }) {
	return (
		<Panel id="console" canvas={props.canvas} ariaLabel="Console" class="console-panel" title="Console">
			<ConsoleHistory />
			<ConsoleForm />
		</Panel>
	);
}

function ConsoleHistory() {
	const app = useApp();
	let el!: HTMLDivElement;
	// Follow the tail: watching messages arrive is the whole point, and a macro
	// that emits faster than you scroll is useless if it doesn't stick to the end.
	createEffect(() => {
		app.om.console.length; // track
		el.scrollTop = el.scrollHeight;
	});
	return (
		<div class="console-history" ref={el}>
			<Show when={app.om.console.length} fallback={<p class="console-empty">No replies yet.</p>}>
				<For each={app.om.console}>
					{line => (
						<div class="console-line">
							<time>{new Date(line.receivedAt).toLocaleTimeString(undefined, { hour12: false })}</time>
							<span class="console-text">{line.text}</span>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}

function ConsoleForm() {
	const app = useApp();
	const [code, setCode] = createSignal("");
	const send = (event: SubmitEvent): void => {
		event.preventDefault();
		const value = code().trim();
		if (value === "") return;
		setCode("");
		void app.connector.sendCode(value).catch(() => undefined);
	};
	return (
		<form class="console-form" onSubmit={send}>
			<input
				type="text"
				placeholder="Send G-code — e.g. M114"
				aria-label="G-code command"
				value={code()}
				onInput={e => setCode(e.currentTarget.value)}
			/>
			<button type="submit">Send</button>
		</form>
	);
}
