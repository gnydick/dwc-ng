/**
 * Dev-only Mock/Real backend selection. In dev the Vite server proxies rr_
 * requests server-side to either a local mock-duet ("" prefix) or the real
 * board ("/real" prefix — see vite.config.ts), so the browser never talks to
 * the board directly (no CORS). The choice persists in localStorage.
 *
 * This is a development affordance: in a standalone production build RRF serves
 * the UI itself and there is only one same-origin backend, so the toggle is
 * gated behind import.meta.env.DEV at its call sites and tree-shakes away.
 */
import { createSignal } from "solid-js";

export interface Backend {
	id: "mock" | "real";
	label: string;
	/** Request prefix the connector uses (matches a vite proxy route). */
	baseUrl: string;
	password: string;
}

export const BACKENDS: Backend[] = [
	{ id: "mock", label: "Mock", baseUrl: "", password: "" },
	// The real board's password (RRF default "reprap" on Gabe's machine) can be
	// overridden with VITE_DWC_PASSWORD. Dev-only; never in a production bundle.
	{ id: "real", label: "Real", baseUrl: "/real", password: import.meta.env.VITE_DWC_PASSWORD ?? "reprap" },
];

const STORAGE_KEY = "dwc-ng-dev-backend";

export function initialBackend(): Backend {
	if (!import.meta.env.DEV) return BACKENDS[0]!;
	try {
		const id = localStorage.getItem(STORAGE_KEY);
		return BACKENDS.find(b => b.id === id) ?? BACKENDS[0]!;
	} catch {
		return BACKENDS[0]!;
	}
}

export function rememberBackend(id: Backend["id"]): void {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		// Private-mode / storage-disabled: selection just won't persist.
	}
}

/**
 * Which backend the connector is pointed at right now. The toggle updates it;
 * the write guard reads it. Separate from the persisted value because what
 * matters for safety is where we are, not what we once chose.
 */
const [currentBackendId, setCurrentBackendId] = createSignal<Backend["id"]>(initialBackend().id);
export { currentBackendId, setCurrentBackendId };

/**
 * Whether writes to the REAL board are armed. Deliberately in-memory only —
 * NEVER persisted. A stale "this is fine" surviving a reload into a fresh tab
 * is precisely how a print and a bogus config write reached real hardware.
 * Every reload starts disarmed; switching backends disarms.
 */
const [writesArmed, setWritesArmed] = createSignal(false);
export { writesArmed, setWritesArmed };
