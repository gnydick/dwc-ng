import type { JSX } from "solid-js";
import { GAP_PX, GRID_COLS, ROW_GAP_PX } from "./panelCanvas.ts";

/**
 * The grid metrics, emitted from the SAME constants the drag math uses
 * (audit M9): app.css used to carry a second hand-synced copy
 * (repeat(48, 46px) etc.) guarded only by a "keep in sync" comment — drift
 * silently diverged the cursor from the panel. Now CSS has no copy to
 * drift.
 *
 * BOTH tracks are var(--u), NOT the ROW_UNIT_PX/COL_UNIT_PX constants: they
 * track the UI scale (index.css, shell/scale.ts), so a scale step shrinks or
 * grows every card's box along with its contents and the stored layout is
 * never rewritten. The drag math reads the same custom property through
 * unitPx(), so cursor and card cannot diverge on either axis — the shared
 * authority just moved from TS constants to one CSS token.
 */
const GRID_STYLE: JSX.CSSProperties = {
	"grid-template-columns": `repeat(${GRID_COLS}, var(--u))`,
	"grid-auto-rows": "var(--u)",
	// Both constants are 0 (the gutters live on the card, not on the grid — see
	// GRID_COLS), and zero is zero at every scale.
	"column-gap": `${GAP_PX}px`, // px-ok: GAP_PX is 0
	"row-gap": `${ROW_GAP_PX}px`, // px-ok: ROW_GAP_PX is 0
};

/** The 48-column grid container a view renders its <Panel>s into. */
export function PanelCanvas(props: { class?: string; children: JSX.Element }) {
	return (
		<div class={props.class ? `panel-canvas ${props.class}` : "panel-canvas"} style={GRID_STYLE}>
			{props.children}
		</div>
	);
}
