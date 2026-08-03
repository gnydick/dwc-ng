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
import type { Transport } from "@dwc-ng/connector";

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
	// The real board's password comes from VITE_DWC_PASSWORD (.env.local).
	// Dev-only; never in a production bundle.
	{ id: "real", label: "Real", baseUrl: "/real", password: realPassword(), transport: "rr", real: true },
	{ id: "real-dsf", label: "Real·DSF", baseUrl: "/real", password: realPassword(), transport: "dsf", real: true },
];

/**
 * The dev board's password, from the environment only.
 *
 * This used to fall back to "reprap" — one developer's board password baked
 * into project source. Empty is the honest default: a board with no password
 * accepts it, and a board WITH one fails loudly as InvalidPasswordError rather
 * than appearing to work because someone else's credential happened to match.
 * Set VITE_DWC_PASSWORD in .env.local; see .env.example.
 */
function realPassword(): string {
	const configured = viteEnv["VITE_DWC_PASSWORD"];
	return typeof configured === "string" ? configured : "";
}

const STORAGE_KEY = "dwc-ng-dev-backend";

/**
 * A dialect PINNED at build time, or null to detect it at boot.
 *
 * A production bundle requires no configuration: it is served by the printer,
 * so it is same-origin, and there is no way to know in advance what someone
 * will name their machine or which firmware it runs. Pinning is an
 * optimisation for a deploy that already knows (packages/deploy --mode), never
 * a requirement.
 *
 * null is a THIRD state meaning "ask the board" — deliberately not a stand-in
 * for either dialect, which is what made the old hard-coded "rr" silent.
 */
declare const __DWC_TRANSPORT__: Transport | null | undefined;

/**
 * The pinned dialect, or null when the build did not pin one (and under plain
 * Node, where a `define` simply does not exist — a module that throws on
 * import outside Vite is a fragility, not a feature).
 */
export const pinnedTransport = (): Transport | null =>
	typeof __DWC_TRANSPORT__ === "undefined" || __DWC_TRANSPORT__ === null ? null : __DWC_TRANSPORT__;

/**
 * The machine serving this page: same origin, no password. Only the dialect
 * was ever in question, and the build answered it.
 *
 * This used to return BACKENDS[0] — a DEV record whose transport is hard-coded
 * "rr". Two bugs in one line: production's identity was "whatever happens to
 * be first in a dev-only array", and every board was driven as standalone rr_.
 * On a Duet 3 + SBC that means DSF's rr_ EMULATION rather than its native
 * /machine API, which reports a thinner object model — observed 2026-07-24 on
 * the first real deploy as "there aren't as many object model entries".
 */
export function machineBackend(transport: Transport): Backend {
	return { id: "real", label: "Machine", baseUrl: "", password: "", transport, real: true };
}

/**
 * DEV boots from the persisted toggle. PRODUCTION does not call this — it
 * builds its backend from a transport that main.tsx has already resolved, so
 * there is no path here that has to invent one.
 */
export function initialBackend(transport: Transport): Backend {
	if (!isDev) return machineBackend(transport);
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
 * There is deliberately NO module-level "current backend" here any more.
 *
 * It used to be `createSignal(initialBackend())`, evaluated at module load —
 * the module deciding the session's backend for itself, which is why
 * production could only ever get a hard-coded one and why "we have not asked
 * the board yet" was indistinguishable from an answer. The backend is now
 * resolved once in main.tsx, handed to App as a required prop, and read from
 * AppContext. C14 still holds: the value is created once and never
 * re-pointed; switching persists a choice and reloads.
 */

/**
 * Whether writes to the REAL board are armed. Deliberately in-memory only —
 * NEVER persisted. A stale "this is fine" surviving a reload into a fresh tab
 * is precisely how a print and a bogus config write reached real hardware.
 * Every reload starts disarmed, so a backend switch (which reloads) disarms.
 */
const [writesArmed, setWritesArmed] = createSignal(false);
export { writesArmed, setWritesArmed };
