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
					title={props.canvas.orientationFor(props.id) === "vertical" ? "Switch to landscape layout" : "Switch to portrait layout"}
					aria-label={`Toggle ${props.ariaLabel} layout direction`}
					onClick={() => props.canvas.toggleOrientation(props.id)}
				>
					{/* The icon names the layout you are IN, not the one you would get.
					    It was the other way round, which read as the two being swapped:
					    a card stacked into tall rows — portrait — showed ⇄, and the wide
					    row of cells showed ⇅. The title still describes the ACTION, so
					    between them the button says both where you are and where the
					    click goes. Stored values are untouched: "vertical" is still the
					    stack and "horizontal" still the row, so no card changes what it
					    renders. */}
					{props.canvas.orientationFor(props.id) === "vertical" ? "⇅" : "⇄"}
				</button>
			</Show>
			<button
				type="button"
				class="panel-grip"
				classList={{ picked: props.canvas.isSelected(props.id) }}
				title="Drag to move · Ctrl or Shift click to pick up several"
				aria-label={`Move ${props.ariaLabel}`}
				aria-pressed={props.canvas.isSelected(props.id)}
				onPointerDown={event => {
					// Modifier-click PICKS UP rather than drags: the pointer goes
					// down and comes back up without the card leaving its cell, and
					// the next plain drag on any member carries the whole formation.
					// Checked here rather than inside startMove so a modified press
					// never begins a drag at all — starting one and cancelling it
					// leaves the canvas mid-gesture.
					if (event.ctrlKey || event.metaKey || event.shiftKey) {
						event.preventDefault();
						event.stopPropagation();
						props.canvas.toggleSelected(props.id);
						return;
					}
					props.canvas.startMove(props.id, event);
				}}
			>
				⠿
			</button>
		</div>
	);
}
