import { Show } from "solid-js";
import type { PanelCanvasController } from "./panelCanvas.ts";

/**
 * The sacred header cluster: the layout toggle (optional) and the grab handle.
 * It is always the rightmost thing in a card's header, and nothing else may
 * live to its right — every other header control sits to its left. Panel owns
 * it; a card never renders this directly.
 */
export function PanelTools(props: {
	id: string;
	canvas: PanelCanvasController;
	ariaLabel: string;
	orientationToggle?: boolean;
}) {
	return (
		<div class="panel-tools">
			<Show when={props.orientationToggle}>
				<button
					type="button"
					class="panel-orientation-toggle"
					title={props.canvas.orientationFor(props.id) === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout"}
					aria-label={`Toggle ${props.ariaLabel} layout direction`}
					onClick={() => props.canvas.toggleOrientation(props.id)}
				>
					{props.canvas.orientationFor(props.id) === "vertical" ? "⇄" : "⇅"}
				</button>
			</Show>
			<button
				type="button"
				class="panel-grip"
				title="Drag to move"
				aria-label={`Move ${props.ariaLabel}`}
				onPointerDown={event => props.canvas.startMove(props.id, event)}
			>
				⠿
			</button>
		</div>
	);
}
