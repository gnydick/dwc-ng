import { For, Show, createEffect, createSignal } from "solid-js";
import { useApp } from "./context.ts";
import { Panel } from "./Panel.tsx";
import { classifyReply } from "../om/consoleLog.ts";
import { loadCommandHistory, pushCommand, saveCommandHistory } from "../om/commandHistory.ts";
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
					{line => {
						// A line's text never changes once logged, so severity is a
						// plain render-time derivation — no signal, no drift.
						const severity = classifyReply(line.text);
						return (
							<div
								class="console-line"
								classList={{ "console-line-error": severity === "error", "console-line-warn": severity === "warning" }}
							>
								<time>{new Date(line.receivedAt).toLocaleTimeString(undefined, { hour12: false })}</time>
								<span class="console-text">{line.text}</span>
							</div>
						);
					}}
				</For>
			</Show>
		</div>
	);
}

function ConsoleForm() {
	const app = useApp();
	const [code, setCode] = createSignal("");
	let input!: HTMLInputElement;
	// Recall state. `history` is oldest→newest; `cursor` is null while editing a
	// fresh line, otherwise a valid index into `history`. `draft` holds the
	// in-progress line so ↓ back past the newest entry restores what was typed.
	let history = loadCommandHistory();
	let cursor: number | null = null;
	let draft = "";

	// Solid updates the controlled value synchronously on setCode, so the caret
	// can be parked at the end straight after — recalling a command lands ready
	// to edit or resend, not mid-string.
	const caretToEnd = (): void => {
		const end = input.value.length;
		input.setSelectionRange(end, end);
	};

	const send = (event: SubmitEvent): void => {
		event.preventDefault();
		const value = code().trim();
		if (value === "") return;
		history = pushCommand(history, value);
		saveCommandHistory(history);
		cursor = null;
		draft = "";
		setCode("");
		void app.connector.sendCode(value).catch(() => undefined);
	};

	const recall = (event: KeyboardEvent): void => {
		if (event.key === "ArrowUp") {
			if (history.length === 0) return;
			event.preventDefault();
			if (cursor === null) {
				draft = code(); // stash the fresh line before stepping into history
				cursor = history.length - 1;
			} else if (cursor > 0) {
				cursor -= 1;
			}
			setCode(history[cursor]!);
			caretToEnd();
		} else if (event.key === "ArrowDown") {
			if (cursor === null) return; // not in recall — leave the caret alone
			event.preventDefault();
			if (cursor < history.length - 1) {
				cursor += 1;
				setCode(history[cursor]!);
			} else {
				cursor = null; // stepped back past the newest entry
				setCode(draft);
			}
			caretToEnd();
		}
	};

	return (
		<form class="console-form" onSubmit={send}>
			<input
				ref={input}
				type="text"
				placeholder="Send G-code — e.g. M114"
				aria-label="G-code command"
				value={code()}
				onInput={e => {
					cursor = null; // typing exits recall — this is a fresh line now
					setCode(e.currentTarget.value);
				}}
				onKeyDown={recall}
			/>
			<button type="submit">Send</button>
		</form>
	);
}
