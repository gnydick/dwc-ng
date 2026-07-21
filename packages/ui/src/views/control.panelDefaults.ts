import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Row spans are sized to each card's ACTUAL content (measured in the running
 * app), not guessed. Grid rows are 24px with a 6px gap, so n rows = 30n - 6 px.
 * Cards that grow when the machine is busy (Printing gains a progress block,
 * Tools gains a row per tool) carry a little headroom; the rest are trimmed to
 * what they draw, because a card with 175px of empty space under its content
 * reads as broken rather than spacious.
 */
export const CONTROL_PANEL_DEFAULTS: PanelDefault[] = [
	// Headroom: gains a progress bar, file name and time estimates while printing.
	{ id: "active-job", col: 0, row: 0, colSpan: 24, rowSpan: 6 },
	// Two rows of keys: home per axis, then the compact release row.
	{ id: "homing", col: 0, row: 6, colSpan: 12, rowSpan: 7 },
	// Headroom: one key per tool, and the P-parameter row above them.
	{ id: "tools", col: 12, row: 6, colSpan: 12, rowSpan: 6 },
	// 10, not 8: a tool row per tool plus the bed overflowed at 8 on the
	// 4-tool machine, and a scrollbar is worse than a little slack.
	{ id: "heaters", col: 0, row: 13, colSpan: 12, rowSpan: 10 },
	{ id: "movement", col: 12, row: 13, colSpan: 12, rowSpan: 17 },
	{ id: "fans", col: 0, row: 23, colSpan: 12, rowSpan: 9 },
	{ id: "tuning", col: 0, row: 32, colSpan: 12, rowSpan: 5 },
	// Rendered only when the board reports an ATX port (state.atxPower !== null),
	// but it needs a placement regardless: a panel the canvas has never heard of
	// has nowhere to go.
	{ id: "atx", col: 12, row: 30, colSpan: 12, rowSpan: 5 },
	{ id: "console", col: 0, row: 37, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 47, colSpan: 8, rowSpan: 10 },
];
