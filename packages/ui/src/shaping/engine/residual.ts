// Residual vibration of an impulse train against a damped mode — the
// standard expression from input-shaping theory: the vector sum of each
// impulse's contribution at the damped frequency, decayed to the last impulse.

import type { Mode } from "./fit.ts";
import type { Impulses } from "./shapers.ts";

/** Fraction (0..1) of the unshaped vibration that survives the shaper. */
export function residual(imp: Impulses, mode: Mode): number {
	const wn = 2 * Math.PI * mode.f;
	const wd = wn * Math.sqrt(1 - mode.zeta * mode.zeta);
	let c = 0;
	let s = 0;
	for (let i = 0; i < imp.A.length; i++) {
		const e = Math.exp(mode.zeta * wn * imp.T[i]!);
		c += imp.A[i]! * e * Math.cos(wd * imp.T[i]!);
		s += imp.A[i]! * e * Math.sin(wd * imp.T[i]!);
	}
	return Math.exp(-mode.zeta * wn * imp.T[imp.T.length - 1]!) * Math.hypot(c, s);
}

/** Worst residual when the measured frequency is off by up to ±rel (5 points). */
export function robust(imp: Impulses, mode: Mode, rel = 0.1): number {
	let worst = 0;
	for (const d of [1 - rel, 1 - rel / 2, 1, 1 + rel / 2, 1 + rel]) {
		const m = { ...mode, f: (mode.f * d) as Mode["f"] } as Mode;
		worst = Math.max(worst, residual(imp, m));
	}
	return worst;
}
