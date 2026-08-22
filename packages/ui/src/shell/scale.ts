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
export const SCALES: readonly Scale[] = [
	{ id: "075", factor: 0.75, label: "75" },
	{ id: "0875", factor: 0.875, label: "88" },
	{ id: "100", factor: 1, label: "100" },
	{ id: "1125", factor: 1.125, label: "113" },
	{ id: "125", factor: 1.25, label: "125" },
	{ id: "150", factor: 1.5, label: "150" },
] as const;

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

/** THE PREFERENCE is written from one place — attribute, signal and storage
 *  together — so the document cannot disagree with the control. `withScale`
 *  below is the one sanctioned transient writer of the attribute alone, for
 *  the Card Lab sweep; nothing else may touch `data-scale`. */
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

/**
 * Draw at `step` for the duration of `fn`, then put the document back.
 *
 * DEV ONLY — the Card Lab's scale sweep (dev/LayoutAuditPanel.tsx) has to
 * render every card at 0.75 and 1.5 to measure it, which means writing the
 * attribute without changing the operator's preference. That is the ONE
 * legitimate exception to "setScale is the only writer", and it exists here,
 * beside the rule, rather than as a bare setAttribute in the panel where the
 * rule cannot see it.
 *
 * Deliberately writes NEITHER the signal NOR storage: a sweep is not a
 * choice. Everything that reads the preference (the control, a reload) keeps
 * reading what the operator picked, while the document draws at the step
 * being measured. The restore is in a `finally` and restores the ATTRIBUTE AS
 * FOUND — including "absent", which is what scale 100 is — so a throw
 * mid-sweep cannot strand the UI on 150.
 *
 * `step` is a raw id, not run through parseScale: the sweep names steps that
 * must exist, and silently substituting the default would make a missing CSS
 * block look like a passing measurement.
 */
export async function withScale(step: string | null, fn: () => Promise<void>): Promise<void> {
	if (typeof document === "undefined") {
		await fn();
		return;
	}
	const root = document.documentElement;
	const before = root.getAttribute("data-scale");
	if (step === null) root.removeAttribute("data-scale");
	else root.setAttribute("data-scale", step);
	try {
		await fn();
	} finally {
		if (before === null) root.removeAttribute("data-scale");
		else root.setAttribute("data-scale", before);
	}
}

/** Apply the stored scale at boot. Idempotent. */
export function applyStoredScale(): void {
	setScale(scale());
}
