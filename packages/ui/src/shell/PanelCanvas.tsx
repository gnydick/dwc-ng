import type { JSX } from "solid-js";
import { COL_UNIT_PX, GAP_PX, GRID_COLS, ROW_GAP_PX, ROW_UNIT_PX } from "./panelCanvas.ts";

/**
 * The grid metrics, emitted from the SAME constants the drag math uses
 * (audit M9): app.css used to carry a second hand-synced copy
 * (repeat(48, 46px) etc.) guarded only by a "keep in sync" comment — drift
 * silently diverged the cursor from the panel. Now CSS has no copy to
 * drift.
 */
const GRID_STYLE: JSX.CSSProperties = {
	"grid-template-columns": `repeat(${GRID_COLS}, ${COL_UNIT_PX}px)`,
	"grid-auto-rows": `${ROW_UNIT_PX}px`,
	"column-gap": `${GAP_PX}px`,
	"row-gap": `${ROW_GAP_PX}px`,
};

/** The 48-column grid container a view renders its <Panel>s into. */
export function PanelCanvas(props: { class?: string; children: JSX.Element }) {
	return (
		<div class={props.class ? `panel-canvas ${props.class}` : "panel-canvas"} style={GRID_STYLE}>
			{props.children}
		</div>
	);
}
