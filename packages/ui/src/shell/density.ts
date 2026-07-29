/**
 * UI density — how much air the layout spends, expressed as a component lead
 * pitch (the domain's own word for centre-to-centre spacing).
 *
 * A per-device preference, not machine configuration: the shop monitor and the
 * phone in your pocket want different densities from the SAME machine. So it
 * persists to localStorage and never touches the config overlay, which uploads
 * to the SD card and drives the dirty/"Save to machine" cycle. Same reasoning
 * as shell/navState.ts and shell/speedFlowMode.ts.
 *
 * The mechanism is one attribute on <html>. index.css holds the baseline
 * spacing tokens on :root and an override block per non-default pitch, so:
 *
 *   - "127" is the ABSENCE of an override, not a copy of the baseline values.
 *     There is exactly one place the default spacing is written down, so the
 *     default and the "default pitch" cannot drift apart.
 *   - Deleting this whole feature (module, control, attribute) leaves the UI
 *     rendering byte-identically to how it did before it existed.
 */
import { createSignal } from "solid-js";

export interface Pitch {
	id: string;
	/** Millimetres, as printed on the package. Purely a label. */
	label: string;
	/** What it feels like, for the control's title text. */
	note: string;
}

/**
 * The pitches, loosest first. DECLARED rather than derived from the CSS: the
 * stylesheet is the authority on what each pitch *is*, this list is the
 * authority on which ones exist. A pitch listed here with no CSS block simply
 * renders as the baseline — it cannot render as something broken.
 */
export const PITCHES: Pitch[] = [
	{ id: "127", label: "1.27", note: "Today's spacing" },
	{ id: "080", label: "0.80", note: "Snug — about a quarter of the air removed" },
	{ id: "050", label: "0.50", note: "Dense — about half the air removed" },
	{ id: "040", label: "0.40", note: "Fine — the practical floor" },
];

export const DEFAULT_PITCH = PITCHES[0]!.id;

const KEY = "dwc-ng.density-pitch";

/** Tolerant parse: an id we don't ship yields the default, never a throw. */
export function parsePitch(raw: string | null): string {
	return PITCHES.some(p => p.id === raw) ? raw! : DEFAULT_PITCH;
}

function load(): string {
	if (typeof localStorage === "undefined") return DEFAULT_PITCH;
	try {
		return parsePitch(localStorage.getItem(KEY));
	} catch {
		return DEFAULT_PITCH;
	}
}

const [pitch, setPitchSignal] = createSignal<string>(load());
export { pitch };

/**
 * Write the attribute AND the signal from one place, so a caller cannot set
 * the preference without the document following it. The document is the only
 * thing that renders; the signal exists so the control can show which is on.
 */
export function setPitch(id: string): void {
	const next = parsePitch(id);
	setPitchSignal(next);
	if (typeof document !== "undefined") {
		document.documentElement.setAttribute("data-pitch", next);
	}
	try {
		localStorage.setItem(KEY, next);
	} catch {
		// Private mode / quota: the choice just won't survive a reload.
	}
}

/** Apply the stored pitch at boot. Idempotent; safe to call more than once. */
export function applyStoredPitch(): void {
	setPitch(pitch());
}
