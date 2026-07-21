import type { JSX } from "solid-js";
import { Panel } from "./Panel.tsx";
import { CardHead } from "./CardHead.tsx";
import type { PanelCanvasController } from "./panelCanvas.ts";

/**
 * A whole card: Panel's chrome (grip, resize, scroll glow, orientation
 * toggle) plus a CardHead (title + optional copy-to-clipboard tip), with
 * the interior left to fill in via children. Most cards fit this shape;
 * ones that don't (Settings' Reset-button headers, System/Macros' no-file
 * Editor state) still compose Panel + CardHead directly.
 */
export function Card(props: {
	id: string;
	canvas: PanelCanvasController;
	ariaLabel: string;
	title: string;
	tip?: JSX.Element;
	/** The card's own header controls (float-right zone) — close, save, reset… */
	actions?: JSX.Element;
	class?: string;
	orientationToggle?: boolean;
	children: JSX.Element;
}) {
	return (
		<Panel id={props.id} canvas={props.canvas} ariaLabel={props.ariaLabel} class={props.class} orientationToggle={props.orientationToggle}>
			<CardHead title={props.title} tip={props.tip} actions={props.actions} />
			{props.children}
		</Panel>
	);
}
