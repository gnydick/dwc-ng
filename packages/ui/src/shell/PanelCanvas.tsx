import type { JSX } from "solid-js";

/** The 24-column grid container a view renders its <Panel>s into. */
export function PanelCanvas(props: { class?: string; children: JSX.Element }) {
	return (
		<div class={props.class ? `panel-canvas ${props.class}` : "panel-canvas"}>
			{props.children}
		</div>
	);
}
