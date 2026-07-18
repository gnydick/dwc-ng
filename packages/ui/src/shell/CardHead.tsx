import { Show, type JSX } from "solid-js";
import { CardTip } from "./CardTip.tsx";

/**
 * Every card's header: a title, plus an optional small tip naming what
 * powers it (an object-model path, a G-code command, a file path, an API
 * endpoint...) — click the tip to copy it (see CardTip). Omit `tip` for a
 * card with nothing to name (e.g. an embedded editor).
 */
export function CardHead(props: { title: string; tip?: JSX.Element }) {
	return (
		<div class="card-head">
			<h2 class="card-title">{props.title}</h2>
			<Show when={props.tip}>
				<CardTip>{props.tip}</CardTip>
			</Show>
		</div>
	);
}
