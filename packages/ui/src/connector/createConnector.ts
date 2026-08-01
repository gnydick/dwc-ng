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
 * @rung 6  choke-point — createConnector is the only construction site in src;
 *          nothing else calls `new PollConnector` or `new DsfConnector`
 * @why exactly one transport may drive the store per session, and two
 *      connectors racing to write the same object model would interleave
 *      subtree replacements with no way to tell which won
 * @debt stop re-exporting the classes from connector/index.ts and make them
 *       module-private, so a second construction site is a compile error rather
 *       than merely absent. Blocked only by the tests, which construct
 *       PollConnector directly against mock-duet (test/config.test.ts,
 *       test/connector.test.ts) — they would take a test-only factory.
 */
import type { Connector, ConnectorEvents } from "./types.ts";
import { PollConnector } from "./PollConnector.ts";
import { DsfConnector } from "./DsfConnector.ts";

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
export async function probeTransport(baseUrl: string, timeoutMs = 2000): Promise<Transport> {
	try {
		const res = await fetch(`${baseUrl}/machine/status`, { signal: AbortSignal.timeout(timeoutMs) });
		if (res.ok || res.status === 401 || res.status === 403) return "dsf";
		return "rr";
	} catch {
		return "rr";
	}
}
