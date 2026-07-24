import { createSignal, onCleanup, type JSX } from "solid-js";
import { copyText } from "./copyText.ts";

const RESET_MS = { copied: 1200, failed: 2400 } as const;

type CopyState = "idle" | "copied" | "failed";

/**
 * The small tag in a card-head naming what powers it — an object-model
 * path, a G-code command, a file path, an API endpoint. Click copies
 * whatever's currently displayed (its rendered text, so a reactive path
 * like a file browser's current directory copies its live value) to the
 * clipboard.
 *
 * Copying goes through shell/copyText.ts, which falls back to a
 * selection-based copy when navigator.clipboard is missing — and it is missing
 * on every non-secure origin, including the SD card this UI is meant to be
 * served from.
 *
 * A failure SAYS SO. The previous version swallowed every error into a bare
 * catch, so a clipboard that could not work looked exactly like a button that
 * did nothing — which is precisely how it went unnoticed. The label is the only
 * place an operator can learn the difference.
 */
export function CardTip(props: { children: JSX.Element }) {
	let el!: HTMLButtonElement;
	const [state, setState] = createSignal<CopyState>("idle");
	let resetTimer = 0;

	const copy = async (): Promise<void> => {
		const ok = await copyText(el.textContent ?? "");
		setState(ok ? "copied" : "failed");
		window.clearTimeout(resetTimer);
		// Failure lingers longer than success: "Copied!" only confirms what you
		// already expected, while "Can't copy" is news, and news needs reading.
		resetTimer = window.setTimeout(() => setState("idle"), ok ? RESET_MS.copied : RESET_MS.failed);
	};
	onCleanup(() => window.clearTimeout(resetTimer));

	const title = (): string => {
		if (state() === "copied") return "Copied!";
		if (state() === "failed") return "The browser refused the copy";
		return "Click to copy";
	};

	return (
		<button
			type="button"
			ref={el}
			class="card-tip"
			classList={{ copied: state() === "copied", failed: state() === "failed" }}
			title={title()}
			onClick={() => void copy()}
		>
			{state() === "copied" ? "Copied!" : state() === "failed" ? "Can't copy" : props.children}
		</button>
	);
}
