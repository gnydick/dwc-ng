import type { JSX } from "solid-js";
import type { PanelCanvasController } from "./panelCanvas.ts";

/**
 * Wraps a view's card section so it sits on that view's grid canvas at an
 * explicit (col, row, colSpan, rowSpan). The move/resize grips are small
 * tabs straddling the card's border, independent of whatever a view puts
 * inside — some cards (e.g. System's Editor) don't always render their
 * own card-head.
 */
export function Panel(props: {
	id: string;
	canvas: PanelCanvasController;
	ariaLabel: string;
	class?: string;
	children: JSX.Element;
}) {
	return (
		<section
			class={props.class ? `card panel ${props.class}` : "card panel"}
			aria-label={props.ariaLabel}
			data-panel-id={props.id}
			style={props.canvas.styleFor(props.id)}
		>
			<button
				type="button"
				class="panel-grip"
				title="Drag to move"
				aria-label={`Move ${props.ariaLabel}`}
				onPointerDown={event => props.canvas.startMove(props.id, event)}
			>
				⠿
			</button>
			{props.children}
			<div
				class="panel-resize-grip"
				title="Drag to resize"
				aria-label={`Resize ${props.ariaLabel}`}
				onPointerDown={event => props.canvas.startResize(props.id, event)}
			/>
		</section>
	);
}
