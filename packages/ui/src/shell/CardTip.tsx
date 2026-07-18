import { createSignal, onCleanup, type JSX } from "solid-js";

const COPIED_RESET_MS = 1200;

/**
 * The small tag in a card-head naming what powers it — an object-model
 * path, a G-code command, a file path, an API endpoint. Click copies
 * whatever's currently displayed (its rendered text, so a reactive path
 * like a file browser's current directory copies its live value) to the
 * clipboard.
 */
export function CardTip(props: { children: JSX.Element }) {
	let el!: HTMLButtonElement;
	const [copied, setCopied] = createSignal(false);
	let resetTimer = 0;

	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(el.textContent ?? "");
			setCopied(true);
			window.clearTimeout(resetTimer);
			resetTimer = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
		} catch {
			// Clipboard API unavailable or permission denied — nothing else to do.
		}
	};
	onCleanup(() => window.clearTimeout(resetTimer));

	return (
		<button
			type="button"
			ref={el}
			class="card-tip"
			classList={{ copied: copied() }}
			title={copied() ? "Copied!" : "Click to copy"}
			onClick={copy}
		>
			{copied() ? "Copied!" : props.children}
		</button>
	);
}
