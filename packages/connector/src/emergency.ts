/**
 * The emergency-stop vocabulary — ONE payload constant and ONE matcher, at
 * the connector layer so every party that must agree on "this is an e-stop"
 * reads the same definition: the STOP buttons (via cmd.emergencyStop), the
 * dev write guard (which must always let it through), and PollConnector's
 * unblockable send path (which must never queue or status-gate it). Before
 * this module the payload existed as four independent literals; editing one
 * would have made the guard block the STOP button with nothing failing.
 *
 * @invariant estop-vocabulary
 * @rung 6  choke-point — one exported payload, one matcher, and since
 *          connector/gcode-producers was branded there is no longer any route
 *          by which a party can send its own "M112" literal: reaching sendCode
 *          at all means coming from cmd.emergencyStop (which returns THIS
 *          constant) or the one named escape hatch. Welded by
 *          test/emergency-stop.test.ts, which asserts what the STOP button
 *          sends is exactly what the guard lets through
 * @why a guard that swallows an emergency stop is more dangerous than the thing
 *      it guards; the four independent literals this replaced could drift apart
 *      with nothing failing until someone needed the button on real hardware
 * @debt the constant and the matcher remain two facts that must agree. Promote
 *       to 7 by deriving the matcher FROM the payload — parse EMERGENCY_STOP
 *       once into the accepted line set — so there is one fact rather than two.
 */

/**
 * What the STOP button sends, as one payload: M112 halts immediately, M999
 * resets so the board comes back. Verified against reference/duet-gcode.md
 * (M112: Emergency Stop, M999: Restart) and
 * reference/dwc/src/components/buttons/EmergencyBtn.vue:2 ('M112\nM999').
 */
export const EMERGENCY_STOP = "M112\nM999";

/**
 * True only for an emergency stop: a bare M112, or the M112+M999 halt-and-reset
 * pair the STOP button sends as a single payload. An e-stop must never be
 * blocked — a guard that swallows it is more dangerous than the thing it
 * guards — so this has to track what the button actually sends, or it fails
 * closed on the real board in the default unarmed state.
 *
 * Still strict: the pair must be exactly those two codes in that order, so this
 * can't be used to smuggle anything else through in the same call.
 */
export function isEmergencyStop(code: string): boolean {
	const lines = code
		.replace(/;.*$/gm, "")
		.split("\n")
		.map(line => line.trim().toUpperCase())
		.filter(line => line !== "");
	if (lines[0] !== "M112") return false;
	return lines.length === 1 || (lines.length === 2 && lines[1] === "M999");
}
