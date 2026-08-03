/**
 * Per-panel content orientation ("vertical" default, "horizontal" opt-in) —
 * independent of panelCanvas.ts's grid geometry (col/row/span), since this
 * is about how a card arranges ITS OWN content, not where the card sits on
 * the grid. Only cards that declare support (Panel's orientationToggle
 * prop) ever show a toggle or read this; every other panel defaults to
 * "vertical" and never touches it. Kept as its own small module rather than
 * folded into PanelRect/CanvasState so the well-tested geometry/collision
 * system in panelCanvas.ts didn't need to change shape for this.
 */

import { safeEntries } from "@dwc-ng/connector";

export type Orientation = "vertical" | "horizontal";

export type OrientationState = Record<string, Orientation>;

function isOrientation(value: unknown): value is Orientation {
	return value === "vertical" || value === "horizontal";
}

/** Tolerant parse: anything unexpected yields an empty map, never a throw. */
export function parseOrientationState(raw: string | null): OrientationState {
	if (raw === null || raw === "") return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null) return {};
	const out: OrientationState = {};
	for (const [id, value] of safeEntries(parsed as Record<string, unknown>)) {
		if (isOrientation(value)) out[id] = value;
	}
	return out;
}

export function serializeOrientationState(state: OrientationState): string {
	return JSON.stringify(state);
}

export function toggledOrientation(current: Orientation): Orientation {
	return current === "vertical" ? "horizontal" : "vertical";
}
