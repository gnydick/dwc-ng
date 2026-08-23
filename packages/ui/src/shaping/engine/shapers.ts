/**
 * Input-shaper impulse trains exactly as RepRapFirmware 3.6 builds them, so
 * the residual this engine predicts is the residual the firmware will leave.
 * Semantics were read from RRF's src/Movement/AxisShaper.cpp (3.6-dev) as
 * reference and rewritten here; nothing is copied.
 *
 * @invariant shaper-definitions-are-one-table
 * @rung 8  illegal state unrepresentable — ShaperSpec is a discriminated
 *          union, impulses() is one exhaustive switch with a `never` arm, and
 *          a named shaper carries F/S while a custom one carries H/T; there is
 *          no way to pair a type with the wrong parameter set, and adding a
 *          shaper type to ShaperType stops compilation until its arm exists
 * @why M593's named and custom forms take different parameters; emitting the
 *      wrong set is a silently different shaper on the machine
 */

import { type Hz, type Seconds } from "./units.ts";

export type ShaperType = "zvd" | "zvdd" | "zvddd" | "mzv" | "ei2" | "ei3";
export const SHAPER_TYPES: readonly ShaperType[] = ["zvd", "zvdd", "zvddd", "mzv", "ei2", "ei3"];

export type ShaperSpec =
	| { readonly type: ShaperType; readonly F: Hz; readonly S: number }
	| { readonly type: "custom"; readonly H: readonly number[]; readonly T: readonly Seconds[] };

/** Amplitudes (sum 1) and times (s, T[0] = 0, strictly increasing). */
export type Impulses = { readonly A: Float64Array; readonly T: Float64Array };

function finish(partial: number[], times: number[]): Impulses {
	const last = 1 - partial.reduce((a, b) => a + b, 0);
	return { A: Float64Array.from([...partial, last]), T: Float64Array.from(times) };
}

export function impulses(spec: ShaperSpec): Impulses {
	if (spec.type === "custom") {
		const sum = spec.H.reduce((a, b) => a + b, 0);
		if (!(sum < 1) || spec.H.some((h) => !(h > 0))) throw new RangeError("custom shaper: amplitudes must be positive and sum to less than 1");
		if (spec.H.length !== spec.T.length) throw new RangeError("custom shaper: H and T must have the same length");
		const times = [0, ...spec.T.map(Number)];
		for (let i = 1; i < times.length; i++) if (!(times[i]! > times[i - 1]!)) throw new RangeError("custom shaper: delays must be strictly increasing");
		return finish([...spec.H], times);
	}
	const zeta = spec.S;
	const root = Math.sqrt(1 - zeta * zeta);
	const td = 1 / (spec.F * root); // damped period — RRF spaces every impulse on it
	const k = Math.exp((-zeta * Math.PI) / root);
	switch (spec.type) {
		case "zvd": {
			const j = (1 + k) ** 2;
			return finish([1 / j, (2 * k) / j], [0, td / 2, td]);
		}
		case "zvdd": {
			const j = (1 + k) ** 3;
			return finish([1 / j, (3 * k) / j, (3 * k * k) / j], [0, td / 2, td, 1.5 * td]);
		}
		case "zvddd": {
			const j = (1 + k) ** 4;
			return finish([1 / j, (4 * k) / j, (6 * k * k) / j, (4 * k ** 3) / j], [0, td / 2, td, 1.5 * td, 2 * td]);
		}
		case "mzv": {
			// RRF takes Klipper's MZV amplitudes but places them in the reverse
			// order (k² term first). Modelled as the firmware does it.
			const km = Math.exp((-zeta * 0.75 * Math.PI) / root);
			const a1 = 1 - 0.5 * Math.SQRT2;
			const a2 = (Math.SQRT2 - 1) * km;
			const a3 = a1 * km * km;
			const tot = a1 + a2 + a3;
			return finish([a3 / tot, a2 / tot], [0, (3 * td) / 8, (3 * td) / 4]);
		}
		case "ei2": {
			const z2 = zeta * zeta;
			const z3 = z2 * zeta;
			return finish(
				[
					0.16054 + 0.76699 * zeta + 2.2656 * z2 - 1.2275 * z3,
					0.33911 + 0.45081 * zeta - 2.5808 * z2 + 1.7365 * z3,
					0.34089 - 0.61533 * zeta - 0.68765 * z2 + 0.42261 * z3,
				],
				[
					0,
					(0.4989 + 0.1627 * zeta - 0.54262 * z2 + 6.1618 * z3) * td,
					(0.99748 + 0.18382 * zeta - 1.5827 * z2 + 8.1712 * z3) * td,
					(1.4992 - 0.09297 * zeta - 0.28338 * z2 + 1.8571 * z3) * td,
				],
			);
		}
		case "ei3": {
			const z2 = zeta * zeta;
			const z3 = z2 * zeta;
			return finish(
				[
					0.11275 + 0.76632 * zeta + 3.2916 * z2 - 1.4438 * z3,
					0.23698 + 0.61164 * zeta - 2.5785 * z2 + 4.8522 * z3,
					0.30008 - 0.19062 * zeta - 2.1456 * z2 + 0.13744 * z3,
					0.23775 - 0.73297 * zeta + 0.46885 * z2 - 2.0865 * z3,
				],
				[
					0,
					(0.49974 + 0.23834 * zeta + 0.44559 * z2 + 12.472 * z3) * td,
					(0.99849 + 0.29808 * zeta - 2.3646 * z2 + 23.399 * z3) * td,
					(1.4987 + 0.10306 * zeta - 2.0139 * z2 + 17.032 * z3) * td,
					(1.9996 - 0.28231 * zeta + 0.61536 * z2 + 5.4045 * z3) * td,
				],
			);
		}
		default: {
			const unhandled: never = spec;
			throw new Error(`unknown shaper type: ${String((unhandled as { type: unknown }).type)}`);
		}
	}
}

/** Plain ZV (two impulses) — the building block for a custom two-mode shaper. */
export function zv(f: Hz, zeta: number): Impulses {
	const root = Math.sqrt(1 - zeta * zeta);
	const k = Math.exp((-zeta * Math.PI) / root);
	return finish([1 / (1 + k)], [0, 0.5 / (f * root)]);
}

/** Two impulse trains applied in series: every pairwise (amplitude product, delay sum). */
export function convolve(a: Impulses, b: Impulses): Impulses {
	const acc = new Map<number, number>();
	for (let i = 0; i < a.A.length; i++) {
		for (let j = 0; j < b.A.length; j++) {
			const t = Math.round((a.T[i]! + b.T[j]!) * 1e9) / 1e9;
			acc.set(t, (acc.get(t) ?? 0) + a.A[i]! * b.A[j]!);
		}
	}
	const times = [...acc.keys()].sort((x, y) => x - y);
	const amps = times.map((t) => acc.get(t)!);
	const sum = amps.reduce((x, y) => x + y, 0);
	return { A: Float64Array.from(amps.map((x) => x / sum)), T: Float64Array.from(times) };
}

/** Duration of a shaper = time of its last impulse. */
export function duration(imp: Impulses): Seconds {
	return imp.T[imp.T.length - 1]! as Seconds;
}
