import { Show, type JSX } from "solid-js";
import { CardTip } from "./CardTip.tsx";

/**
 * Every card's header, in four zones, left to right:
 *
 *   [ title · tip ……spacer…… actions │ GRIP+TOGGLE ]
 *     left    float-left        float-right   right (sacred)
 *
 * - **left**        — the title.
 * - **float-left**  — the tip (what powers the card), hugging the title.
 * - **float-right** — the card's own controls: close, save, reset, hide…
 * - **right**       — the SACRED cluster: the layout toggle and the grab
 *                     handle. Panel owns and pins these; nothing else may live
 *                     there. Space for it is reserved in CSS, so a float-right
 *                     control can never slide under the grab handle — every
 *                     other header control sits to its left.
 */
export function CardHead(props: { title: string; tip?: JSX.Element; actions?: JSX.Element }) {
	return (
		<div class="card-head">
			<h2 class="card-title">{props.title}</h2>
			<Show when={props.tip}>
				<CardTip>{props.tip}</CardTip>
			</Show>
			<Show when={props.actions}>
				<div class="card-actions">{props.actions}</div>
			</Show>
		</div>
	);
}
