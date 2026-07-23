import { Show, For, Switch, Match, createSignal, createMemo, createEffect, on } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { MessageBoxMode, ackCommand, initialInput, isBlocking, needsInput, type AckInput } from "./ack.ts";

/**
 * The M291 prompt. When RRF raises a box with mode >= okOnly it is BLOCKED,
 * waiting for M292 — so this is not a notification, it is the only thing
 * standing between the operator and a machine that appears to have hung.
 *
 * Rendered from the Shell so it covers every view: a blocking prompt that only
 * appears on the page you happen to be looking at is the same bug as not having
 * one. Message text is rendered as PLAIN TEXT (newlines preserved) — DWC injects
 * it as HTML, which we deliberately don't do.
 */
export function MessageBoxPrompt() {
	const app = useApp();

	const box = () => app.om.om.state.messageBox;
	const [input, setInput] = createSignal<number | string>("");
	const [answeredSeq, setAnsweredSeq] = createSignal<number | null>(null);
	const [error, setError] = createSignal("");

	// Re-seed whenever a DIFFERENT box arrives. Keyed on seq, not on the object:
	// a macro raising several prompts in a row must reset the field each time,
	// and polling hands us a fresh object on every tick regardless.
	createEffect(on(() => box()?.seq, seq => {
		if (seq === undefined) return;
		const current = box();
		if (current !== null) setInput(initialInput(current));
		setError("");
	}));

	// Hide as soon as we've answered THIS seq, rather than waiting for the poll
	// to clear it — otherwise every acknowledgement feels like a stuck button.
	// If the firmware raises another box it carries a new seq and shows again.
	const visible = createMemo(() => {
		const current = box();
		return current !== null && current.seq !== answeredSeq();
	});

	const answer = (ack: AckInput | null): void => {
		const current = box();
		if (current === null) return;
		const code = ackCommand(current, ack);
		setAnsweredSeq(current.seq);
		if (code === null) return;
		void app.connector.sendCode(code).catch((err: unknown) => {
			// Failed to acknowledge: the machine is still waiting, so put the
			// prompt back rather than leaving the operator thinking it went through.
			setAnsweredSeq(null);
			setError(err instanceof Error ? err.message : String(err));
		});
	};

	const emergencyStop = (): void => {
		// A STOP that did not reach the board must say so, in the prompt's
		// existing error line — never a silent no-op.
		void app.connector.sendCode(cmd.emergencyStop())
			.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
	};

	const numeric = (): boolean =>
		box()?.mode === MessageBoxMode.intInput || box()?.mode === MessageBoxMode.floatInput;

	return (
		<Show when={visible() ? box() : null}>
			{b => (
				<div
					class="mbox-scrim"
					classList={{ blocking: isBlocking(b()) }}
					onClick={() => { if (!isBlocking(b())) answer(null); }}
				>
					<div
						class="mbox"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="mbox-title"
						onClick={e => e.stopPropagation()}
					>
						{/* Title alone: the top-right corner belongs to the stop button. */}
						<div class="mbox-head">
							<span id="mbox-title" class="mbox-title">
								{b().title || "Message from the machine"}
							</span>
						</div>

						<p class="mbox-message">{b().message}</p>

						<Show when={needsInput(b())}>
							<form
								class="mbox-form"
								onSubmit={e => { e.preventDefault(); answer({ value: input() }); }}
							>
								<Switch>
									<Match when={numeric()}>
										<input
											class="mbox-input"
											type="number"
											autofocus
											step={b().mode === MessageBoxMode.intInput ? 1 : "any"}
											min={b().min ?? undefined}
											max={b().max ?? undefined}
											value={String(input())}
											onInput={e => setInput(e.currentTarget.valueAsNumber)}
										/>
									</Match>
									<Match when={true}>
										<input
											class="mbox-input"
											type="text"
											autofocus
											minLength={b().min ?? undefined}
											maxLength={b().max ?? undefined}
											value={String(input())}
											onInput={e => setInput(e.currentTarget.value)}
										/>
									</Match>
								</Switch>
							</form>
						</Show>

						<Show when={error()}>
							<p class="mbox-error">Couldn’t acknowledge: {error()}</p>
						</Show>

						<div class="mbox-actions">
							<span class="mbox-src">M291 · seq {b().seq}</span>
							<Switch>
								<Match when={b().mode === MessageBoxMode.multipleChoice}>
									<For each={b().choices ?? []}>
										{(choice, i) => (
											<button
												class="btn mbox-btn"
												classList={{ "mbox-default": b().default === i() }}
												onClick={() => answer({ value: i() })}
											>
												{choice}
											</button>
										)}
									</For>
								</Match>
								<Match when={b().mode !== MessageBoxMode.noButtons}>
									<button
										class="btn mbox-btn mbox-default"
										disabled={!canConfirm(b().min, b().max, input(), needsInput(b()), numeric())}
										onClick={() => answer(needsInput(b()) ? { value: input() } : null)}
									>
										{isBlocking(b()) ? "OK" : "Close"}
									</button>
								</Match>
							</Switch>
							<Show when={b().cancelButton}>
								<button class="btn mbox-btn" onClick={() => answer({ cancelled: true })}>Cancel</button>
							</Show>
						</div>

						{/* The prompt covers the whole UI, so the stop button has to
						    live inside it — DWC reaches the same conclusion. */}
						<Show when={isBlocking(b())}>
							<button class="estop mbox-estop" title="Emergency stop — sends M112 + M999" onClick={emergencyStop}>
								STOP<small>M112</small>
							</button>
						</Show>
					</div>
				</div>
			)}
		</Show>
	);
}

/** Bounds check mirroring what RRF will accept, so OK can't submit a value the firmware rejects. */
function canConfirm(
	min: number | null,
	max: number | null,
	value: number | string,
	requiresInput: boolean,
	isNumeric: boolean,
): boolean {
	if (!requiresInput) return true;
	if (isNumeric) {
		if (typeof value !== "number" || !Number.isFinite(value)) return false;
		if (min !== null && value < min) return false;
		if (max !== null && value > max) return false;
		return true;
	}
	const length = String(value).length;
	if (min !== null && length < min) return false;
	if (max !== null && length > max) return false;
	return true;
}
