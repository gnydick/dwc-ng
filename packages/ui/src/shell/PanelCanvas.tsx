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

/**
 * The 48-column grid container a view renders its <Panel>s into.
 *
 * `vars` is a custom-property scope for the screen (GIT_194 inc 5: the
 * per-screen spacing tokens from config/screenSpacing.ts spacingVars) —
 * custom properties inherit, so a token set here re-grounds every var()
 * read by the cards below.
 *
 * @invariant grid-metrics-unoverridable
 * @rung 7  illegal state unrepresentable, in two halves. The four grid
 *          metric keys cannot be shadowed because GRID_STYLE spreads LAST —
 *          a caller's value for the same key is overwritten by the object
 *          spread, structurally, not reviewed-for (the metrics are the drag
 *          math's other half; see GRID_STYLE). And a caller cannot smuggle
 *          any OTHER real CSS property in through `vars` either: the prop's
 *          keys are typed `--${string}`, so `vars={{ display: "block" }}` —
 *          which would destroy the grid as inline style while leaving the
 *          four metrics intact — is a compile error, not a reviewed-for
 *          convention. Custom properties are the only thing the type can
 *          say, and custom properties are the only thing the scope is FOR
 * @why the canvas's inline grid metrics and the drag math are two halves of
 *      one geometry (unitPx reads the same --u token); a screen-level style
 *      scope that could override the metrics — or the container's display —
 *      would let a config-driven token walk the cursor away from the card
 *      it is dragging
 */
export function PanelCanvas(props: { class?: string; vars?: { [key: `--${string}`]: string }; children: JSX.Element }) {
	return (
		<div class={props.class ? `panel-canvas ${props.class}` : "panel-canvas"} style={{ ...props.vars, ...GRID_STYLE }}>
			{props.children}
		</div>
	);
}
