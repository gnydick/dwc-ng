import type { JSX } from "solid-js";
import type { PanelLayoutController } from "./panelLayout.ts";

/**
 * Wraps a view's card section so it participates in that view's rearrangeable
 * grid. The drag/resize grips are small tabs straddling the card's border,
 * independent of whatever a view puts inside — some cards (e.g. System's
 * Editor) don't always render their own card-head.
 */
export function Panel(props: {
	id: string;
	layout: PanelLayoutController;
	ariaLabel: string;
	class?: string;
	children: JSX.Element;
}) {
	return (
		<section
			class={props.class ? `card panel ${props.class}` : "card panel"}
			aria-label={props.ariaLabel}
			data-panel-id={props.id}
			style={props.layout.styleFor(props.id)}
		>
			<button
				type="button"
				class="panel-grip"
				title="Drag to reorder"
				aria-label={`Reorder ${props.ariaLabel}`}
				onPointerDown={event => props.layout.startReorder(props.id, event)}
			>
				⠿
			</button>
			{props.children}
			<div
				class="panel-resize-grip"
				title="Drag to resize"
				aria-label={`Resize ${props.ariaLabel}`}
				onPointerDown={event => props.layout.startResize(props.id, event)}
			/>
		</section>
	);
}
