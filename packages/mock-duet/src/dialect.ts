/**
 * Which HTTP dialects a CLI-launched mock serves.
 *
 * WHY THIS EXISTS (GIT_194). The DSF surface used to be opt-in (`--dsf`,
 * default false), so the mock a developer got by typing `pnpm mock:start`
 * served the rr_ dialect ONLY. Nothing said so: the port answered, `rr_connect`
 * was healthy, and the process looked exactly like a working mock. Flipping the
 * UI's dev backend toggle to `Mock·DSF` against it then failed in a way that
 * named neither half of the mismatch — `GET /machine/connect` 404s, which
 * `DsfConnector.fetchSessionKey` deliberately swallows as sessionless parity
 * (DSF before 3.4-b4 has no connect route), so the first visible symptom was
 * `/machine websocket: socket error` from an http server that simply has no
 * upgrade handler registered. Observed 2026-08-31: the running UAT mock (pid
 * 924, port 8194) had no `--dsf`, so the DSF path had never been exercised at
 * all, and the seeded Beeper card was reported "missing in DSF mode" when in
 * fact the connection that would have loaded it never opened.
 *
 * THE FIX IS THE DEFAULT, not a louder error. This project's target machine is
 * a Duet 3 + SBC — the bundled capture is a DSF `GET /machine/model` of it — so
 * a mock that omits DSF unless asked has the default backwards. Both dialects
 * are served unless the operator explicitly asks for a standalone board, which
 * joins `--unidentified` and `--frozen-screen` as a DELIBERATE degradation: a
 * board with no `/machine` routes is a real state the UI must handle
 * (`probeTransport` exists for exactly it), so it stays reachable on purpose
 * rather than by omission.
 *
 * @invariant dsf-flags-cannot-disagree
 * @rung 6  choke point — this is the only function that turns the CLI's two
 *          boolean flags into a dialect, `cli.ts` calls nothing else to derive
 *          one, and it REFUSES the single input pair that would otherwise pick
 *          a winner silently. Downstream sees one resolved value, never two
 *          booleans that could be read in either order
 * @why `--dsf --standalone` names two incompatible boards. Letting either flag
 *      win would make the served surface depend on argument order or on which
 *      branch was written first, and the whole point of GIT_194 is that "which
 *      dialects is this mock serving" must never be a guess
 * @debt rung 7 would take a single `--dialect <both|standalone>` option so the
 *       contradictory pair is unrepresentable rather than refused. `--dsf` is
 *       kept because it is already documented, already passed through by
 *       `mockctl`, and already in operators' shell history
 */

/** The dialects a mock serves. `dsf` false = standalone board: no /machine at all. */
export interface Dialect {
	/** Serve the DSF surface: /machine/* REST plus the /machine WebSocket. */
	readonly dsf: boolean;
	/** How the value was arrived at, for the startup banner. */
	readonly why: "default" | "--dsf" | "--standalone";
}

export class ContradictoryDialectError extends Error {
	constructor() {
		super(
			"--dsf and --standalone name different boards: --dsf serves the /machine surface, " +
				"--standalone serves none. Pick one (omit both for the default, which serves both dialects).",
		);
		this.name = "ContradictoryDialectError";
	}
}

/**
 * Resolve the CLI's dialect flags. Omitting both serves BOTH dialects, which
 * is what a developer driving either backend toggle wants and what the target
 * machine actually is.
 */
export function resolveDialect(flags: { dsf?: boolean; standalone?: boolean }): Dialect {
	const dsf = flags.dsf === true;
	const standalone = flags.standalone === true;
	if (dsf && standalone) throw new ContradictoryDialectError();
	if (standalone) return { dsf: false, why: "--standalone" };
	if (dsf) return { dsf: true, why: "--dsf" };
	return { dsf: true, why: "default" };
}
