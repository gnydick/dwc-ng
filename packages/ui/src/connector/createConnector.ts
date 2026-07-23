/**
 * The ONE place a connector is constructed (design D9, invariant C1).
 *
 * Two transports now speak to a machine — rr_ (RRF standalone, and DSF's
 * rr_ emulation) and DSF's native /machine API — and exactly one may drive
 * the store per session. That is enforced by construction rather than by
 * discipline: `Transport` is a closed union, this switch over it is
 * exhaustive with no default arm (adding a transport makes every
 * un-updated site a compile error), and no other module constructs a
 * connector. A caller holds a `Connector`; which transport it is cannot
 * leak into the UI, which is the whole point of the abstraction.
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
 * /machine routes at all, so a short-timeout probe separates them without
 * ambiguity. Any failure means rr_ — the historical default, and the one
 * that also works when the probe is merely slow.
 */
export async function probeTransport(baseUrl: string, timeoutMs = 2000): Promise<Transport> {
	try {
		const res = await fetch(`${baseUrl}/machine/status`, { signal: AbortSignal.timeout(timeoutMs) });
		return res.ok ? "dsf" : "rr";
	} catch {
		return "rr";
	}
}
