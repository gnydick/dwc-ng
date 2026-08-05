import { FileNotFoundError, InvalidPasswordError, OperationFailedError } from "@dwc-ng/connector";

/**
 * Make the job-details card fail on demand, so its failure state can be LOOKED
 * at without owning a file the machine cannot read.
 *
 * A URL parameter, deliberately, and not a control in Settings. Two reasons, and
 * the second is the real one:
 *
 *   · a permanent toggle for a state you want to see once is clutter that
 *     outlives its purpose, and Settings has no diagnostics section to hide it
 *     in — it would need a whole card of its own;
 *   · a toggle can be switched on and forgotten. This cannot: it is sitting in
 *     the address bar in plain sight, and it is gone the moment the tab is
 *     reopened. There is no persisted state to go stale, which is exactly the
 *     failure mode the write guard exists because of (a "I'm on the mock" belief
 *     outliving the tab that formed it, 2026-07-16).
 *
 * Read from `location.search` rather than the hash, so the hand-rolled hash
 * router never sees it and needs no parsing changes.
 *
 * SHIPS to the board, unlike the dev backend strip (gated behind
 * import.meta.env.DEV in Shell.tsx), because the board is where the operator
 * tests. That is safe here in a way it would not be for a write: this only makes
 * a READ fail, and a failed read hides Start print rather than offering it, so
 * the flag's only influence on the machine is to withhold an action.
 *
 * Usage: http://<board>/?forceJobInfoError=parse#/jobs
 *        ...=missing   the file is gone
 *        ...=session   the session expired
 */
export const FORCE_PARAM = "forceJobInfoError";

/**
 * Every message says SIMULATED and names the parameter.
 *
 * Not decoration. An injected failure that reads exactly like a real one is a
 * trap for whoever sees it next — including the person who set it, an hour
 * later — and the cost of that confusion is a hunt for a machine fault that does
 * not exist. Saying how to turn it off in the same breath means the escape is
 * never more than the message itself.
 */
const MARK = `SIMULATED (?${FORCE_PARAM} is set in the URL — remove it for real behaviour)`;

/**
 * The forced error for a query string, or null when the parameter is absent.
 *
 * Takes the search string rather than reading `location` itself, so the mapping
 * is a pure function that can be tested without a DOM — and so the one place
 * that touches global state is the three-line caller below.
 */
export function forcedJobInfoError(search: string): Error | null {
	let value: string | null;
	try {
		value = new URLSearchParams(search).get(FORCE_PARAM);
	} catch {
		return null;
	}
	if (value === null) return null;
	if (value === "missing") return new FileNotFoundError(`0:/gcodes/example.gcode — ${MARK}`);
	// InvalidPasswordError fixes its own message, so the mark is appended after
	// construction rather than passed in. The TYPE is what the card's mapping
	// keys on, and mutating the message leaves that untouched — building a
	// look-alike Error instead would change the summary the card shows, which is
	// the one thing this is here to demonstrate.
	if (value === "session") {
		const err = new InvalidPasswordError();
		err.message = `${err.message} — ${MARK}`;
		return err;
	}
	// Anything else, including a bare `?forceJobInfoError`, shows the case this
	// exists for: the machine answered, and could not read the file.
	return new OperationFailedError(
		`${MARK}\nFailed to parse G-code file 0:/gcodes/example.gcode: `
		+ "unexpected end of file at offset 4673248 while reading thumbnail block QOI/160x160",
	);
}

/** The live reading, for the one caller that has a real URL. Null off-DOM. */
export function forcedJobInfoErrorNow(): Error | null {
	if (typeof location === "undefined") return null;
	return forcedJobInfoError(location.search);
}
