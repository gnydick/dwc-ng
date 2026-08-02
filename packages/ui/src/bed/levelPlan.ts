/**
 * Deciding what to move, for the manual iterative bed level.
 *
 * This is the G32-FREE procedure: probe the configured point beside each
 * leadscrew, then drive that screw's own axis until the three readings agree.
 * Because each probe point sits ~16-21mm from its screw on a ~340mm bed, a
 * reading is essentially that screw's height — the correction is ~1:1, no lever
 * arm, and crucially NO DEPENDENCE ON M671. That is what makes it the thing to
 * reach for when the bed's state, or the pivot configuration, is in doubt.
 *
 * Pure decision logic: it computes moves, it does not send them. Nothing here
 * talks to a connector, so the arithmetic that decides how far a bed moves is
 * testable without a machine.
 *
 * Levelness is the three readings AGREEING; their absolute value is the Z datum
 * and is re-established by homing afterwards. So the target is the readings'
 * own mean — the correction that moves the bed least, and the one least likely
 * to run a screw toward its limit.
 *
 * ── Trigger height is deliberately NOT subtracted here. ──────────────────────
 * Readings are the RAW machine Z that G30 S-1 reports, sitting near the probe's
 * G31 Z (about -13 on this machine). Every quantity this module computes is a
 * DIFFERENCE — the spread, and each corner's error about the mean — so the
 * trigger height is a constant common to all three readings and cancels
 * identically. Subtracting it would change nothing.
 *
 * That is only true while the readings are compared against EACH OTHER. A
 * consumer that ever wants an absolute bed height must apply
 * heightmap/probeReply.ts's heightmapValue() instead, which is where that
 * correction lives (and where omitting it once put a ~13mm error into every
 * re-probed cell).
 *
 * Related and equally load-bearing: the bed is slightly WARPED, so these three
 * readings are taken at three different XY and are NOT three samples of a
 * plane — part of any difference between them is surface, not tilt. Levelling
 * to agreement at these three spots is the goal; whatever surface variation
 * remains is what the height map is probed afterwards to capture.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Which screw a probe point reports on. */
export type LevelAxis = "U" | "V" | "W";

export interface LevelReading {
	axis: LevelAxis;
	/** Machine Z the probe triggered at (G30 S-1). Larger = that corner is HIGH. */
	reading: number;
}

export interface LevelMove {
	axis: LevelAxis;
	/** Signed distance to move that axis, mm. */
	delta: number;
	/** True when the safety clamp shortened this move. */
	clamped: boolean;
}

export interface LevelPlan {
	/** Empty once the readings agree within tolerance. */
	moves: LevelMove[];
	/** max - min of the readings, mm: the out-of-level figure. */
	spread: number;
	/** Within tolerance — stop iterating. */
	level: boolean;
	/** Any move was shortened by the clamp, so expect more iterations. */
	clamped: boolean;
}

export interface LevelOptions {
	/** Stop when the spread is at or under this, mm. */
	tolerance: number;
	/**
	 * Fraction of the measured error to correct per iteration. Under 1 on
	 * purpose: the bed is rigid, so moving one corner shifts the others a
	 * little, and taking the whole error every time invites oscillation around
	 * the mechanical floor rather than settling into it.
	 */
	relaxation: number;
	/**
	 * Hard cap on a single axis move, mm. THE safety limit: over-tilting the bed
	 * damages the probe, so no single step may tilt it far, however large the
	 * measured error is (a mis-seated probe or a bad tap can report metres).
	 *
	 * A caller may only ever LOWER it. See HARD_MAX_STEP_MM.
	 *
	 * @invariant no-single-step-over-tilts-the-bed
	 * @rung 7  the violating state has no expression — planLevel is the sole
	 *          producer of a LevelMove, and the cap it applies is
	 *          `Math.min(options.maxStep, HARD_MAX_STEP_MM)`, so no input can
	 *          RAISE the limit. Passing 100 yields 0.5. Promoted from rung 5 on
	 *          2026-08-01, where the bound was whatever the caller supplied and
	 *          only DEFAULT_LEVEL_OPTIONS made it safe
	 * @why a mis-seated probe or a bad tap reports a reading in METRES, and the
	 *      correction is ~1:1 with the reading. Uncapped, one bad sample drives a
	 *      screw its whole travel in a single move and the far side of the bed
	 *      lifts into the probe. The failure is mechanical damage, not a wrong
	 *      number, and it happens before anyone can read the plan. Downward
	 *      adjustment stays open because a cautious caller wanting SMALLER steps
	 *      is asking for more safety, not less
	 */
	maxStep: number;
	/**
	 * +1 when INCREASING an axis lowers that corner (increases nozzle-to-bed
	 * distance), -1 when it raises it. Not assumed: it depends on the machine's
	 * drive directions, and guessing it wrong drives the bed INTO the probe.
	 * Must be established by observation before the first unattended run.
	 *
	 * @invariant drive-direction-is-observed-never-assumed
	 * @rung 0  the type pins the MAGNITUDE and nothing pins the SIGN. "Must be
	 *          established by observation" is a caller precondition in prose —
	 *          the anti-pattern — and this module cannot check it: a wrong sign
	 *          produces a perfectly well-formed plan
	 * @why the sign decides which way every correction goes, so getting it
	 *      backwards does not level slowly or badly, it drives the bed INTO the
	 *      probe on the FIRST move, and each round makes the error larger. There
	 *      is no reading that looks wrong first
	 * @debt this is the one place in the levelling path where being wrong costs
	 *       hardware and nothing in the code can tell. Promote by making the
	 *       first move of a session a deliberate probe of the sign — move one
	 *       axis by a known small step, re-probe, and require the reading to
	 *       have changed in the predicted direction before any further move is
	 *       planned. That turns an assumption into a measurement, and it is what
	 *       a supervised first run does by hand today.
	 */
	direction: 1 | -1;
}

/**
 * The ceiling on a single axis move, mm — a property of THIS machine's probe
 * and bed, not of any call site, so it is not configurable upward.
 *
 * Well under the "few mm of far-side lift" that damages the probe, while still
 * being 50x a full motor step so progress is quick.
 */
const HARD_MAX_STEP_MM = 0.5;

/** Sensible starting point for this machine; callers may lower maxStep. */
export const DEFAULT_LEVEL_OPTIONS: Omit<LevelOptions, "direction"> = {
	// Two full motor steps. Z/U/V/W run 6400 steps/mm at 64x microstepping, so
	// one FULL step is 10um and corrections below that are executed by stiction
	// rather than by instruction. A tighter tolerance than this is chasing a
	// number the actuator cannot hold.
	tolerance: 0.02,
	relaxation: 0.7,
	maxStep: HARD_MAX_STEP_MM,
};

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * What to move next, given one round of probe readings.
 *
 * Throws on an empty set rather than returning a vacuously "level" plan: no
 * readings is a failed probing round, and reporting that as level would end the
 * loop claiming success it never measured.
 */
export function planLevel(readings: LevelReading[], options: LevelOptions): LevelPlan {
	if (readings.length === 0) throw new Error("planLevel: no readings — a probing round produced nothing");

	const values = readings.map(r => r.reading);
	const spread = Math.max(...values) - Math.min(...values);
	if (spread <= options.tolerance) {
		return { moves: [], spread, level: true, clamped: false };
	}

	const target = mean(values);
	const moves: LevelMove[] = [];
	for (const r of readings) {
		// Positive error = this corner reads high (triggered at a larger Z).
		const error = r.reading - target;
		const wanted = error * options.relaxation * options.direction;
		// The caller's cap, but never above the machine's: an option can lower
		// this and cannot raise it, so "one move over-tilts the bed" is not
		// something any input expresses.
		const limit = Math.min(Math.abs(options.maxStep), HARD_MAX_STEP_MM);
		const capped = Math.max(-limit, Math.min(limit, wanted));
		// A move the machine cannot resolve is not worth a traverse: below one
		// full step it is executed by stiction, in an unpredictable direction.
		if (Math.abs(capped) < 0.001) continue;
		moves.push({ axis: r.axis, delta: capped, clamped: capped !== wanted });
	}
	return { moves, spread, level: false, clamped: moves.some(m => m.clamped) };
}
