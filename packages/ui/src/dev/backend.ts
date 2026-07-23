/**
 * Dev-only backend selection: which machine, over which transport. In dev
 * the Vite server proxies both dialects server-side — rr_ and /machine — to
 * either a local mock-duet ("" prefix) or the real board ("/real" prefix,
 * see vite.config.ts), so the browser never talks to the board directly (no
 * CORS). The choice persists in localStorage.
 *
 * This is a development affordance: in a standalone production build RRF
 * serves the UI itself and there is only one same-origin backend, so the
 * toggle is gated behind import.meta.env.DEV at its call sites and
 * tree-shakes away.
 *
 * Switching backends RELOADS the page (see Shell's BackendToggle): a
 * transport change means a different connector class, so there is no
 * half-switched state to get wrong — the old `switchEndpoint` re-point
 * could not express it and no longer exists (design D9/C14).
 */
import { createSignal } from "solid-js";
import type { Transport } from "../connector/createConnector.ts";

/**
 * `import.meta.env` is injected by the bundler and simply absent under plain
 * Node (tests import this module for the BACKENDS contract). Reading it
 * defensively keeps module LOAD total — the alternative is a module that
 * throws on import in any non-Vite context, which is a fragility, not a
 * feature.
 */
const viteEnv: Record<string, string | boolean | undefined> =
	(import.meta as { env?: Record<string, string | boolean | undefined> }).env ?? {};
const isDev = viteEnv["DEV"] === true;

export interface Backend {
	id: "mock" | "mock-dsf" | "real" | "real-dsf";
	label: string;
	/** Request prefix the connector uses (matches a vite proxy route). */
	baseUrl: string;
	password: string;
	transport: Transport;
	/**
	 * True when this backend is Gabe's actual machine. DECLARED, not derived
	 * from the id: the write guard reads this, and with two real backends a
	 * string comparison against "real" would silently unguard one of them.
	 */
	real: boolean;
}

export const BACKENDS: Backend[] = [
	{ id: "mock", label: "Mock", baseUrl: "", password: "", transport: "rr", real: false },
	{ id: "mock-dsf", label: "Mock·DSF", baseUrl: "", password: "", transport: "dsf", real: false },
	// The real board's password (RRF default "reprap" on Gabe's machine) can be
	// overridden with VITE_DWC_PASSWORD. Dev-only; never in a production bundle.
	{ id: "real", label: "Real", baseUrl: "/real", password: realPassword(), transport: "rr", real: true },
	{ id: "real-dsf", label: "Real·DSF", baseUrl: "/real", password: realPassword(), transport: "dsf", real: true },
];

function realPassword(): string {
	const configured = viteEnv["VITE_DWC_PASSWORD"];
	return typeof configured === "string" && configured !== "" ? configured : "reprap";
}

const STORAGE_KEY = "dwc-ng-dev-backend";

export function initialBackend(): Backend {
	if (!isDev) return BACKENDS[0]!;
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
 * Which backend the connector is pointed at right now. Set once at boot (a
 * switch reloads), and read by the write guard. Separate from the persisted
 * value because what matters for safety is where we are, not what we once
 * chose.
 */
// Read-only on purpose: no setter is exported, so nothing can re-point the
// session's backend at runtime — which is what makes "the connector and the
// selected backend disagree" unrepresentable rather than merely avoided
// (C14). Switching happens by persisting the choice and reloading.
const [currentBackend] = createSignal<Backend>(initialBackend());
export { currentBackend };

/** The write guard's question, answered by the backend's own declaration. */
export function isRealBackend(): boolean {
	return currentBackend().real;
}

/**
 * Whether writes to the REAL board are armed. Deliberately in-memory only —
 * NEVER persisted. A stale "this is fine" surviving a reload into a fresh tab
 * is precisely how a print and a bogus config write reached real hardware.
 * Every reload starts disarmed, so a backend switch (which reloads) disarms.
 */
const [writesArmed, setWritesArmed] = createSignal(false);
export { writesArmed, setWritesArmed };
