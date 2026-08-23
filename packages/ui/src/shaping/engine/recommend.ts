// Pros, cons and notes for a candidate, each from one named rule, so the
// user sees WHY a shaper is or is not recommended and can disagree.

import type { Artefact } from "./artefact.ts";
import type { Fingerprint } from "./fit.ts";
import type { Candidate } from "./rank.ts";

export type NoteRule =
	| "short-shaper"
	| "long-shaper"
	| "robust-band"
	| "narrow-band"
	| "artefact"
	| "unverified"
	| "mzv-rrf-ordering"
	| "both-axes-by-harmonic"
	| "measured-damping";

export type Note = { readonly kind: "pro" | "con" | "note"; readonly rule: NoteRule; readonly text: string };

export type RecommendCtx = {
	readonly fp: Fingerprint;
	/** Tools with their own accelerometer mapping — more than one means the carriage mass varies. */
	readonly toolsConfigured: number;
	readonly verified?: {
		readonly measured: { readonly X?: number; readonly Y?: number };
		readonly artefacts: readonly Artefact[];
	};
};

const ms = (s: number): string => `${Math.round(s * 1000)} ms`;

export function prosCons(c: Candidate, ctx: RecommendCtx): Note[] {
	const out: Note[] = [];
	const dur = c.durationS;
	if (dur <= 0.035) out.push({ kind: "pro", rule: "short-shaper", text: `short shaper (${ms(dur)}): corners barely slowed` });
	else if (dur > 0.06) out.push({ kind: "con", rule: "long-shaper", text: `long shaper (${ms(dur)}): every direction change is smeared over ${ms(dur)}` });

	if (c.spec.type === "ei2" || c.spec.type === "ei3") {
		if (ctx.toolsConfigured > 1) out.push({ kind: "pro", rule: "robust-band", text: `${c.spec.type.toUpperCase()} tolerates a wide frequency band — covers the shift between tools of different mass` });
	} else if (c.spec.type === "zvd" && ctx.toolsConfigured > 1) {
		out.push({ kind: "con", rule: "narrow-band", text: "ZVD tolerates only ±6 % — a different tool on the carriage moves the ring frequency more than that" });
	}

	if (c.spec.type === "mzv") out.push({ kind: "con", rule: "mzv-rrf-ordering", text: "RRF builds MZV with its amplitudes reversed from Klipper's and leaves ~16 % residual even at exact tuning" });

	if (c.spec.type !== "custom" && ctx.fp.X && ctx.fp.Y) {
		const F = c.spec.F;
		for (const [lowAxis, highAxis] of [["X", "Y"], ["Y", "X"]] as const) {
			const lo = ctx.fp[lowAxis]!;
			const hi = ctx.fp[highAxis]!;
			if (Math.abs(F - lo.f) / lo.f < 0.1 && Math.abs(3 * F - hi.f) / hi.f < 0.1) {
				out.push({ kind: "note", rule: "both-axes-by-harmonic", text: `cancels ${highAxis} only because ${highAxis} ≈ 3×${lowAxis} (${hi.f.toFixed(1)} ≈ 3×${lo.f.toFixed(1)} Hz); re-measure after any carriage change` });
			}
		}
	}

	if (c.spec.type !== "custom") {
		const S = c.spec.S;
		const near = (["X", "Y"] as const).filter((a) => ctx.fp[a] && Math.abs(S - ctx.fp[a]!.zeta) <= 0.02);
		if (near.length > 0) out.push({ kind: "pro", rule: "measured-damping", text: `S ${S} matches the measured damping of ${near.join(" and ")}` });
	}

	if (ctx.verified) {
		for (const a of ctx.verified.artefacts) {
			out.push({ kind: "con", rule: "artefact", text: `measured: excites ${a.hz.toFixed(0)} Hz on ${a.axis} (${a.peakG.toFixed(2)} g) that the unshaped machine does not` });
		}
	} else {
		out.push({ kind: "con", rule: "unverified", text: "predicted only — not yet measured on the machine" });
	}
	return out;
}
