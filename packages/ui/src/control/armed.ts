import { createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * A two-step control's ARMED state, with one guaranteed way out.
 *
 * Every destructive or machine-moving control here arms before it fires —
 * Delete, Run, Save to machine — and each grew its own escape hatch, or none:
 * Delete got a Cancel button, Rename and Create got Escape, and the Macros
 * Run confirm got nothing at all. A row left saying "Confirm" whose next click
 * starts a macro, with no way back except toggling an unrelated setting, is the
 * worst of the three, and it is the one nobody noticed.
 *
 * So arming goes through here. One listener, one set — deliberately NOT a
 * per-component listener, since N listeners racing to handle one Escape is how
 * you get a keypress that disarms some controls and not others.
 *
 * @invariant escape-disarms
 * @rung 5  shared helper, optional use — createArmed registers every caller
 *          with ONE capture-phase listener, but arming with a plain
 *          createSignal still works and is not caught by anything
 * @why a control left saying "Confirm", whose next click moves the machine or
 *      flashes firmware, with no way back except toggling an unrelated setting,
 *      is the failure this module exists to delete. "There is always a way out"
 *      is only true if it holds for controls written by someone who never read
 *      this file
 * @debt this file used to claim exactly that, and it was FALSE:
 *       cards/FirmwareUpdateCard.tsx arms with a raw createSignal and Escape
 *       does not reach it (catalogued in DEBT.md as
 *       firmware-arm-bypasses-escape). Promote by converting that card, then
 *       making createArmed the sole route — a test walking src for
 *       `setArmed`/`armed` signals not produced by createArmed gets it to rung
 *       4; a branded Armed<T> accessor that the two-step button components
 *       require gets it to 7.
 */
const disarmers = new Set<() => void>();

let listening = false;
function listenOnce(): void {
	// Guarded for node:test, where these modules are imported without a DOM.
	if (listening || typeof window === "undefined") return;
	listening = true;
	// Capture, so a control that stops propagation on its own keydown cannot
	// leave the rest of the page armed.
	window.addEventListener("keydown", e => {
		if (e.key !== "Escape") return;
		for (const disarm of disarmers) disarm();
	}, { capture: true });
}

/**
 * `[armed, setArmed]` for a control that arms with a value — usually the path
 * or id the confirmation applies to, so the thing shown and the thing done
 * cannot disagree. null = not armed.
 */
export function createArmed<T>(): [Accessor<T | null>, (value: T | null) => void] {
	const [armed, setArmed] = createSignal<T | null>(null);
	const disarm = (): void => { setArmed(null); };
	disarmers.add(disarm);
	onCleanup(() => disarmers.delete(disarm));
	listenOnce();
	return [armed, setArmed];
}

/** Test seam: how many armed controls are currently registered. */
export function armedControlCount(): number {
	return disarmers.size;
}
