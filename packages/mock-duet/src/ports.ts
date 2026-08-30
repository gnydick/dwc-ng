/**
 * The two port classes for dwc-ng dev stacks (GIT_172, ruled by Gabe 2026-08-29).
 *
 * ## 1. The reserved UAT pair — always the same numbers
 *
 *     mock 8970   +   vite 5173
 *
 * Gabe keeps ONE bookmark and expects it to be whatever he is supposed to be
 * driving. Exactly one UAT stack exists at a time; standing a new one up means
 * tearing the previous one down, which is what `mock:stop` / `mock:status`
 * make possible. That is how the teardown rule stops being discipline and
 * becomes something the workflow forces.
 *
 * Both halves are pinned by a mechanism, not by intent:
 *  - the mock cannot silently drift, because `server.listen()` on a taken port
 *    throws `EADDRINUSE` and (Invariant A in `pidfile.ts`) never registers;
 *  - vite CAN drift — it silently increments — so `packages/ui/vite.config.ts`
 *    sets `strictPort: true`. On 2026-08-29 a UAT landed on 5184 and "the UAT
 *    is at 5173" quietly became false with nothing to say so. A fixed port that
 *    drifts silently is worse than no convention, because it is a promise that
 *    breaks without telling you.
 *
 * ## 2. Per-ticket scratch ports — derived, never scavenged
 *
 *     port = 8000 + <ticket number>      GIT_170 -> 8170, GIT_136 -> 8136
 *
 * The convention already existed here unwritten: four of the ten orphans found
 * on 2026-08-29 sat on 8136/8138/8142/8144, exactly matching GIT_136/138/142/
 * 144. It decayed because nothing wrote it down, and dispatches started
 * scavenging arbitrary free ports (8975, 8976, 8199, 8994, 8997, 8999) — which
 * is why identifying the orphans took hand forensics. A derived port makes a
 * stray process self-identifying: the number names the ticket that owns it.
 *
 * 8970 is reserved OUT of the derived range, so a ticket can never collide
 * with the UAT slot: {@link ticketPort} refuses ticket 970 rather than handing
 * back a number that would quietly steal the bookmark.
 */

/** The mock half of the reserved UAT pair. */
export const UAT_MOCK_PORT = 8970;
/** The vite half of the reserved UAT pair (pinned with `strictPort: true`). */
export const UAT_VITE_PORT = 5173;
/** Per-ticket scratch ports are this plus the ticket number. */
export const TICKET_PORT_BASE = 8000;

/** Which class a port belongs to. */
export type PortClass =
	| { kind: "uat" }
	| { kind: "ticket"; ticket: number }
	| { kind: "other" };

export function classifyPort(port: number): PortClass {
	if (port === UAT_MOCK_PORT) return { kind: "uat" };
	const ticket = port - TICKET_PORT_BASE;
	if (ticket >= 1 && port <= 65535 && port > TICKET_PORT_BASE) return { kind: "ticket", ticket };
	return { kind: "other" };
}

/**
 * Short tag for a port, for tables: `UAT`, `GIT_172`, `GIT_975?`, or `-`.
 *
 * The number ALONE cannot prove a port is a ticket port — 8975 was a scavenged
 * port on 2026-08-29, and arithmetic happily reads it as "ticket 975". So the
 * bare tag is a QUESTION (`GIT_975?`): this port looks derived, and here is the
 * ticket it would name. Pass the registry segment that owns the port and the
 * question resolves — `wt-GIT_172` owning 8172 corroborates, and the tag loses
 * its `?`. A confident wrong label in a forensics table is worse than a
 * hedged right one.
 */
export function portTag(port: number | null, segment?: string | null): string {
	if (port === null) return "-";
	const cls = classifyPort(port);
	if (cls.kind === "uat") return "UAT";
	if (cls.kind !== "ticket") return "-";
	const corroborated = segment != null && ticketFromSegment(segment) === cls.ticket;
	return `GIT_${cls.ticket}${corroborated ? "" : "?"}`;
}

/**
 * The ticket a registry segment names, or `null` when it names none.
 *
 * Segments come from `pidfile.ts`: `wt-GIT_172` for a linked worktree of
 * branch GIT_172, `main` for the main checkout. The worktree name ALREADY
 * carries the ticket number, so the scratch port is derived from it rather
 * than typed a second time (technique 8: derive, don't duplicate).
 */
export function ticketFromSegment(segment: string): number | null {
	const m = /^wt-GIT_(\d+)$/.exec(segment);
	return m === null ? null : Number(m[1]);
}

/**
 * The scratch port for a ticket.
 *
 * @invariant a-ticket-port-can-never-be-the-uat-port
 * @rung 6  choke point — this is the only function that turns a ticket number
 *          into a port, `mockctl start` calls nothing else to derive one, and
 *          it throws on the single input (970) whose arithmetic would land on
 *          the reserved slot. The number is never returned and then checked;
 *          there is no value to check
 * @why the UAT stack is a FIXED pair Gabe keeps one bookmark for — mock 8970
 *      with vite 5173 pinned by strictPort. A derivation that could quietly
 *      hand a ticket the same 8970 would let a scratch mock occupy the slot
 *      the bookmark points at, and the bookmark would then answer from the
 *      wrong branch while still looking correct. That is the same failure
 *      shape as the orphan that answered a healthy rr_connect on 2026-08-29
 * @debt rung 8 would make the two classes one sum type minted at the point of
 *       choice, so "a port" with no class simply would not exist to be passed
 *       around. Today an explicit `--port` still yields a bare number
 */
export function ticketPort(ticket: number): number {
	if (!Number.isInteger(ticket) || ticket < 1) {
		throw new Error(`ticket number must be a positive integer, got ${ticket}`);
	}
	const port = TICKET_PORT_BASE + ticket;
	if (port === UAT_MOCK_PORT) {
		throw new Error(
			`ticket ${ticket} would derive port ${port}, which is RESERVED for the UAT stack. ` +
				`Pass an explicit --port for this one.`,
		);
	}
	if (port > 65535) throw new Error(`ticket ${ticket} would derive port ${port}, which is not a port`);
	return port;
}
