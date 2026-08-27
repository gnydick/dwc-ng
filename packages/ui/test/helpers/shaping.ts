// Test helper: obtain a `Mode` the only way one can be obtained — by fitting
// a decay. A clean synthetic ring at (f, zeta) fits back to within the
// estimator's resolution, which is all these tests need.
import { fitDecay, isMode, type Mode, type Fingerprint } from "../../src/shaping/engine/fit.ts";
import { hz, seconds } from "../../src/shaping/engine/units.ts";
import { type Conditions, type Evidence, held, type Provenance } from "../../src/shaping/evidence/evidence.ts";
import type { WorkflowProducts } from "../../src/shaping/steps.ts";
import type { ServiceBaseCtx } from "../../src/compose/services.ts";
import type { Connector } from "@dwc-ng/connector";

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

/**
 * The conditions the prototype baseline was actually taken under
 * (tools/accel/runs/ring/ring1): 100 mm at 100 mm/s, three repeats each way,
 * shaping off, on a machine set to 6000 mm/s².
 *
 * Real numbers rather than round ones, so a test that accidentally compares a
 * measurement against itself cannot pass on zeroes.
 */
export const PROTOTYPE_CONDITIONS: Conditions = {
	shaper: null,
	accelMmPerS2: 6000,
	speedMmPerS: 100,
	distMm: 100,
	repeats: 3,
};

/** A measured provenance, optionally under conditions other than the prototype's. */
export const measuredUnder = (under: Conditions = PROTOTYPE_CONDITIONS): Provenance =>
	({ kind: "measured", at: "2026-08-23T09:14:02", under });

const SOUND: Provenance = measuredUnder();

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

/**
 * The minimum `ServiceBaseCtx` `shapingService` can be constructed against
 * without throwing — for the tests that drive the REAL service factory rather
 * than a reimplementation of one of its parts.
 *
 * `connected: () => false` is load-bearing: both of the service's own
 * `createEffect`s short-circuit on a disconnected base before touching
 * `om`/`config`, which is what makes it safe for those two fields to be empty
 * stand-ins rather than a full object model and config store. `gate` is a
 * `createMemo` and runs EAGERLY at construction, so `accelByTool` has to exist
 * even for a test that never calls `svc.gate()`; empty means `accelFor`
 * returns null for every tool, which is `gate`'s own short-circuit before it
 * would ever reach `base.om.om`.
 *
 * One stub, not one per test file: two of these drifting apart would be two
 * different machines called "the empty one", and a test passing on the wrong
 * one is the failure this whole directory exists to avoid.
 */
export function stubShapingBase(): ServiceBaseCtx {
	return {
		om: { om: {} } as unknown as ServiceBaseCtx["om"],
		config: { config: { shaping: { accelByTool: {} } } } as unknown as ServiceBaseCtx["config"],
		connector: {} as unknown as Connector,
		temps: {} as unknown as ServiceBaseCtx["temps"],
		backend: {} as unknown as ServiceBaseCtx["backend"],
		machineId: () => "unidentified" as unknown as ReturnType<ServiceBaseCtx["machineId"]>,
		configLoaded: () => false,
		connected: () => false,
		onScreen: () => true,
	};
}
