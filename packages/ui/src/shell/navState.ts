/**
 * Whether the left nav rail is hidden — a per-device UI preference (not a
 * machine setting), so it persists to localStorage and survives reloads
 * without following the machine to another browser. When hidden the rail is
 * gone entirely for maximum content width, and a reveal control in the
 * preflight strip brings it back.
 */
import { createSignal } from "solid-js";

const KEY = "dwc-ng.nav-hidden";

function load(): boolean {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

const [navHidden, setNavHiddenSignal] = createSignal(load());

export { navHidden };

export function setNavHidden(hidden: boolean): void {
	setNavHiddenSignal(hidden);
	try {
		localStorage.setItem(KEY, hidden ? "1" : "0");
	} catch {
		// Private mode / storage disabled: the preference just won't persist.
	}
}
