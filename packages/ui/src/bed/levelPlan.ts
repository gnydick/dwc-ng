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
	 */
	maxStep: number;
	/**
	 * +1 when INCREASING an axis lowers that corner (increases nozzle-to-bed
	 * distance), -1 when it raises it. Not assumed: it depends on the machine's
	 * drive directions, and guessing it wrong drives the bed INTO the probe.
	 * Must be established by observation before the first unattended run.
	 */
	direction: 1 | -1;
}

/** Sensible starting point for this machine; callers may override. */
export const DEFAULT_LEVEL_OPTIONS: Omit<LevelOptions, "direction"> = {
	// Two full motor steps. Z/U/V/W run 6400 steps/mm at 64x microstepping, so
	// one FULL step is 10um and corrections below that are executed by stiction
	// rather than by instruction. A tighter tolerance than this is chasing a
	// number the actuator cannot hold.
	tolerance: 0.02,
	relaxation: 0.7,
	// Well under the "few mm of far-side lift" that damages the probe, while
	// still being 50x a full step so progress is quick.
	maxStep: 0.5,
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
		const capped = Math.max(-options.maxStep, Math.min(options.maxStep, wanted));
		// A move the machine cannot resolve is not worth a traverse: below one
		// full step it is executed by stiction, in an unpredictable direction.
		if (Math.abs(capped) < 0.001) continue;
		moves.push({ axis: r.axis, delta: capped, clamped: capped !== wanted });
	}
	return { moves, spread, level: false, clamped: moves.some(m => m.clamped) };
}
