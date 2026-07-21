import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Row spans fitted to each card's measured content on the 4px grid.
 *
 * A card spanning n rows renders (4n - 6)px tall (the 6px is the inter-card
 * margin that replaced the row gap). With every control exactly 28px — or 56px
 * for the jog pad, deliberately 2x — a card's content height is knowable, so
 * these are computed rather than guessed.
 *
 * The two cards that carry slack carry it on purpose: Printing grows a progress
 * block, file name and time estimates once a job starts, and Heaters/Fans gain
 * a row per tool or fan. Everything else is trimmed to what it draws.
 */
export const CONTROL_PANEL_DEFAULTS: PanelDefault[] = [
	// Headroom for the progress block that appears while printing.
	{ id: "active-job", col: 0, row: 0, colSpan: 24, rowSpan: 32 },
	{ id: "homing", col: 0, row: 32, colSpan: 12, rowSpan: 46 },
	{ id: "tools", col: 12, row: 32, colSpan: 12, rowSpan: 28 },
	{ id: "heaters", col: 0, row: 78, colSpan: 12, rowSpan: 58 },
	{ id: "movement", col: 12, row: 78, colSpan: 12, rowSpan: 117 },
	{ id: "fans", col: 0, row: 136, colSpan: 12, rowSpan: 58 },
	{ id: "tuning", col: 0, row: 194, colSpan: 12, rowSpan: 28 },
	// Rendered only when the board reports an ATX port (state.atxPower !== null),
	// but it needs a placement regardless: a panel the canvas has never heard of
	// has nowhere to go.
	{ id: "atx", col: 12, row: 195, colSpan: 12, rowSpan: 28 },
	{ id: "console", col: 0, row: 223, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 298, colSpan: 8, rowSpan: 75 },
];
