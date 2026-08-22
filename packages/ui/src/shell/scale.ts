/**
 * UI scale — how large the whole interface draws, as a multiplier on the one
 * unit (--u) every layout-space length in the UI is written in.
 *
 * Readability, not zoom: type, controls, spacing and the grid itself all
 * follow --u; decorations that do not help you read (borders, hairlines,
 * radii, shadows) stay at their pixel size and occupy no layout space, so a
 * card's floor in stored grid cells is the same number at every step. That is
 * what lets a layout saved on the shop monitor fit on the phone untouched.
 *
 * A per-device preference, not machine configuration, so it persists to
 * localStorage and never touches the config overlay (same reasoning as
 * shell/navState.ts). The mechanism is one attribute on <html>; index.css
 * holds --u on :root and one override block per non-default step, so:
 *
 *   - "100" is the ABSENCE of an override. The default unit is written down
 *     once, on :root, and cannot drift from the step that claims to be it.
 *   - Deleting this feature leaves the UI rendering byte-identically.
 */
import { createSignal } from "solid-js";

export interface Scale {
	id: string;
	/** Multiplier on the default unit. Must match the CSS block (tested). */
	factor: number;
	/** Shown on the control. */
	label: string;
}

/** Smallest first. The stylesheet is the authority on what a step IS; this
 *  list is the authority on which exist. An id with no CSS block renders as
 *  the default — it cannot render as something broken. */
export const SCALES: Scale[] = [
	{ id: "075", factor: 0.75, label: "75" },
	{ id: "0875", factor: 0.875, label: "88" },
	{ id: "100", factor: 1, label: "100" },
	{ id: "1125", factor: 1.125, label: "113" },
	{ id: "125", factor: 1.25, label: "125" },
	{ id: "150", factor: 1.5, label: "150" },
];

export const DEFAULT_SCALE = "100";

const KEY = "dwc-ng.scale";
/** The retired density preference. Read once, mapped, then ignored. */
const LEGACY_KEY = "dwc-ng.density-pitch";

export function parseScale(raw: string | null): string {
	return SCALES.some(s => s.id === raw) ? raw! : DEFAULT_SCALE;
}

/** 1.27 was the default pitch; the tighter pitches all removed air, and the
 *  nearest readable equivalents under a uniform scale are the small steps. */
export function legacyPitchToScale(pitch: string | null): string | null {
	switch (pitch) {
		case "127": return "100";
		case "080": return "0875";
		case "050": return "075";
		case "040": return "075";
		default: return null;
	}
}

function load(): string {
	if (typeof localStorage === "undefined") return DEFAULT_SCALE;
	try {
		const stored = localStorage.getItem(KEY);
		if (stored !== null) return parseScale(stored);
		const mapped = legacyPitchToScale(localStorage.getItem(LEGACY_KEY));
		return mapped ?? DEFAULT_SCALE;
	} catch {
		return DEFAULT_SCALE;
	}
}

const [scale, setScaleSignal] = createSignal<string>(load());
export { scale };

/** Attribute, signal and storage written from one place, so the document
 *  cannot disagree with the control. */
export function setScale(id: string): void {
	const next = parseScale(id);
	setScaleSignal(next);
	if (typeof document !== "undefined") {
		if (next === DEFAULT_SCALE) document.documentElement.removeAttribute("data-scale");
		else document.documentElement.setAttribute("data-scale", next);
	}
	try {
		localStorage.setItem(KEY, next);
	} catch {
		// Private mode / quota: the choice just won't survive a reload.
	}
}

/** Apply the stored scale at boot. Idempotent. */
export function applyStoredScale(): void {
	setScale(scale());
}
