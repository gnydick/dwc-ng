/**
 * The ONE place a connector is constructed (design D9).
 *
 * Two transports now speak to a machine — rr_ (RRF standalone, and DSF's
 * rr_ emulation) and DSF's native /machine API — and exactly one may drive
 * the store per session. A caller holds a `Connector`; which transport it is
 * cannot leak into the UI, which is the whole point of the abstraction.
 *
 * @invariant transport-exhaustive
 * @rung 7  closed union plus a switch with NO default arm — adding a member to
 *          `Transport` makes this function fail to compile until it is handled,
 *          so the compiler writes the TODO list
 * @why a transport that silently falls through would return undefined where the
 *      caller's type says Connector, and the failure would surface far from
 *      here as "the machine never connects"
 *
 * @invariant sole-construction
 * @rung 6  choke-point, now with two things holding it rather than one. The
 *          concrete classes are no longer on connector/index.ts's public face,
 *          so a second site cannot be written against the module's exports; and
 *          test/sole-construction.test.ts scans src for `new PollConnector` /
 *          `new DsfConnector` outside this file, naming any it finds by line
 * @why exactly one transport may drive the store per session, and two
 *      connectors racing to write the same object model would interleave
 *      subtree replacements with no way to tell which won
 * @debt still 6, and the reason is worth being exact about. Removing the
 *       re-exports cost NOTHING — they had zero consumers, since every test
 *       imports PollConnector straight from its own module and App.tsx takes
 *       only createConnector. The previous note here claimed the tests blocked
 *       this; they never used that route. What remains is that any file in this
 *       PACKAGE can still import ./PollConnector.ts directly, and no runtime
 *       mechanism can prevent source that has not been written yet — freeze,
 *       seal and #private all constrain values during execution, while "a
 *       second route is added" is a fact about a future edit. Rung 7 therefore
 *       needs a boundary the compiler enforces: move the connector into its own
 *       workspace package with one entry point, which also unlocks
 *       raw-transport-fence by letting @dwc-ng/ui shadow `fetch` as never.
 */
import type { Connector, ConnectorEvents } from "./types.ts";
import { PollConnector } from "./PollConnector.ts";
import { DsfConnector } from "./DsfConnector.ts";
import { realClock, type Clock } from "./clock.ts";

// --- platform-timer shadow (invariant connector/clock-seam) -----------------
// Module-scoped shadows of the platform's timers: `setTimeout(...)` in this
// file is a COMPILE ERROR ("type 'never' has no call signatures"), not a silent
// return to wall time. Every deferral here goes through the injected Clock, so
// a test can drive a deadline instead of waiting it out. The declarations erase
// to nothing at runtime; test/clock-fence.test.ts checks they are still here.
declare const setTimeout: never;
declare const clearTimeout: never;
declare const setInterval: never;
declare const clearInterval: never;
declare const setImmediate: never;
declare const performance: never;
declare const AbortSignal: never;

/** Which dialect a backend speaks. Closed on purpose (C1). */
export type Transport = "rr" | "dsf";

export interface ConnectorTarget {
	transport: Transport;
	/** Request prefix (a vite proxy route in dev; "" same-origin in production). */
	baseUrl: string;
	password: string;
}

export function createConnector(target: ConnectorTarget, events: ConnectorEvents): Connector {
	switch (target.transport) {
		case "rr":
			return new PollConnector({ baseUrl: target.baseUrl, password: target.password, events });
		case "dsf":
			return new DsfConnector({ baseUrl: target.baseUrl, password: target.password, events });
	}
}

/**
 * Which transport this origin serves, for a production boot that has no dev
 * toggle to read. DSF answers /machine/status; standalone RRF has no
 * /machine routes at all, so a short-timeout probe separates them.
 *
 * A 401/403 counts as DSF, not failure: a password-protected DSF refuses the
 * keyless probe with 403, but the ROUTE existing at all is the proof — a
 * standalone board has no /machine handler to refuse with. Only a genuine
 * absence (404, a non-auth error) or a network/timeout failure means rr_ —
 * the historical default, and the one that also works when the probe is
 * merely slow.
 *
 * NOTE (design D9): this is not yet wired into App's production boot, which
 * still constructs from the dev backend record — production auto-detection
 * is DEFERRED (the campaign was verified in dev against the SBC via the
 * toggle; standalone-vs-DSF auto-select needs a standalone board to verify
 * against, which we do not have). The probe is kept sound and tested so the
 * wiring, when it lands, is correct.
 */
export async function probeTransport(baseUrl: string, timeoutMs = 2000, clock: Clock = realClock): Promise<Transport> {
	try {
		const res = await fetch(`${baseUrl}/machine/status`, { signal: clock.timeoutSignal(timeoutMs) });
		if (res.ok || res.status === 401 || res.status === 403) return "dsf";
		return "rr";
	} catch {
		return "rr";
	}
}
