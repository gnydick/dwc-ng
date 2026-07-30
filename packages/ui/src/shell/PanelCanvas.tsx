import type { JSX } from "solid-js";
import { COL_UNIT_PX, GAP_PX, GRID_COLS, ROW_GAP_PX } from "./panelCanvas.ts";

/**
 * The grid metrics, emitted from the SAME constants the drag math uses
 * (audit M9): app.css used to carry a second hand-synced copy
 * (repeat(48, 46px) etc.) guarded only by a "keep in sync" comment — drift
 * silently diverged the cursor from the panel. Now CSS has no copy to
 * drift.
 *
 * The row track is var(--row-unit), NOT the ROW_UNIT_PX constant: it tracks the
 * density pitch (index.css), so tightening the pitch shrinks every card's box
 * along with its contents and the stored layout is never rewritten. The drag
 * math reads the same custom property through rowUnitPx(), so cursor and card
 * still cannot diverge — the shared authority just moved from a TS constant to
 * a CSS token. Columns keep the constant: density scales air, not type, so
 * widths move only 0.91–0.98 and scaling them would buy a few percent while
 * risking clipped text.
 */
const GRID_STYLE: JSX.CSSProperties = {
	"grid-template-columns": `repeat(${GRID_COLS}, ${COL_UNIT_PX}px)`,
	"grid-auto-rows": "var(--row-unit)",
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
