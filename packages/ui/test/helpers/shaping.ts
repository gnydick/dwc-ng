// Test helper: obtain a `Mode` the only way one can be obtained — by fitting
// a decay. A clean synthetic ring at (f, zeta) fits back to within the
// estimator's resolution, which is all these tests need.
import { fitDecay, isMode, type Mode, type Fingerprint } from "../../src/shaping/engine/fit.ts";
import { hz, seconds } from "../../src/shaping/engine/units.ts";
import { type Evidence, held, type Provenance } from "../../src/shaping/evidence/evidence.ts";
import type { WorkflowProducts } from "../../src/shaping/steps.ts";

export function modeForTest(f: number, zeta: number, amp = 0.3, rate = 2688): Mode {
	const n = Math.round(1.2 * rate);
	const x = new Float64Array(n);
	const wn = 2 * Math.PI * f;
	const wd = wn * Math.sqrt(1 - zeta * zeta);
	for (let i = 0; i < n; i++) {
		const t = i / rate - 0.03;
		if (t >= 0) x[i] = amp * Math.exp(-zeta * wn * t) * Math.cos(wd * t);
	}
	const r = fitDecay(x, hz(rate), seconds(0.03), { windowS: 1.1 });
	if (!isMode(r)) throw new Error(`modeForTest(${f}, ${zeta}) did not fit: ${JSON.stringify(r)}`);
	return r;
}

/** The prototype machine's fingerprint (tools/accel/runs/ring/ring1/fingerprint.json). */
export function prototypeFingerprint(): Fingerprint {
	const X = modeForTest(18.1, 0.127, 0.05);
	const Y = modeForTest(51.6, 0.075, 0.103);
	return { X, Y, n: { X: 6, Y: 6 }, spreadHz: { X: 0.5, Y: 1.2 } };
}

/**
 * The five products as "is it there or not", for tests that are about step
 * readiness rather than about findings.
 *
 * A test that says `{ fingerprint: true }` is saying the tool HAS a sound
 * fingerprint — no caveats, measured provenance. Tests that care what limits a
 * product build the `Evidence` themselves; this shorthand exists so the
 * readiness cases stay about readiness.
 */
export type Have = Partial<Record<"fingerprint" | "sweep" | "candidates" | "verified" | "applied", boolean>>;

const SOUND: Provenance = { kind: "measured", at: "2026-08-23T09:14:02", tool: 0 };

export const productsOf = (have: Have = {}): WorkflowProducts => {
	const one = (yes: boolean | undefined): Evidence<unknown> => (yes === true ? held({}, SOUND, []) : { state: "absent" });
	return {
		fingerprint: one(have.fingerprint),
		sweep: one(have.sweep),
		candidates: one(have.candidates),
		verified: one(have.verified),
		applied: one(have.applied),
	};
};
