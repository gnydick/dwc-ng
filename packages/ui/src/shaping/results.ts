/**
 * The per-tool shaping results file: its path, its wire shape, and the parse
 * boundary that separates "text on the SD card" from the typed results the
 * cards render.
 *
 * The file sits next to config.g on a card the operator can mount, edit and
 * copy between machines, so it is hostile input in exactly the sense
 * config/parse.ts means: well-formed JSON with the wrong types inside is the
 * realistic failure, not garbage bytes. Nothing here casts JSON.parse output
 * to a type — every field is rebuilt.
 *
 * Two things are deliberately NOT read from the file:
 *
 *  - a candidate's scores. A candidate is written as its shaper SPEC alone and
 *    re-scored through `candidateFor(spec, fingerprint)` on read. The residual
 *    of a spec against a fingerprint is derivable, and a derived value stored
 *    beside its inputs is a value that will eventually disagree with them —
 *    after a shaper-model fix, or after someone edits the card.
 *  - a verified candidate's verdict. It is written as its spec plus the
 *    fingerprint measured during the verify run, and rebuilt by re-running
 *    `verifyAnalysis` — the sole producer of the verified brand (I6). A file
 *    cannot assert "this was verified"; it can only carry the measurement that
 *    makes the analysis come out that way.
 *
 * @invariant results-file-is-parsed-not-cast
 * @rung 6  choke-point — parseResults is the only route from the card's text
 *          to a ToolResults, it is TOTAL (no input throws), and it refuses the
 *          whole file rather than dropping a bad record. Refusing whole is the
 *          difference from the config overlay: a dropped preference falls back
 *          to a default, whereas a dropped capture would silently change a
 *          fingerprint the operator is about to tune a machine against
 * @why the results file is the only place a measurement survives a reload, and
 *      the numbers in it end up as the M593 line written into tpostN.g
 * @debt the path is a plain string, so a future writer could reach
 *       0:/sys/dwc-ng/shaping/… without coming through the store (spec I7 is
 *       rung 6 for this reason). Promote by branding the path so only this
 *       module can produce one, tracked on GitHub #19.
 */
import { isPlainObject } from "@dwc-ng/connector";
import { type Axis, type Fingerprint, type Mode, type NoFit, reviveFingerprint, reviveMode } from "./engine/fit.ts";
import { type Candidate, candidateFor } from "./engine/rank.ts";
import { SHAPER_TYPES, type ShaperSpec, type ShaperType } from "./engine/shapers.ts";
import type { SweepMatrix } from "./engine/sweep.ts";
import { g, type G, hz, type Hz, mmPerS, type Seconds, seconds } from "./engine/units.ts";
import { type VerifiedCandidate, verifyAnalysis } from "./store.ts";

/** Bumped when the wire shape changes; a file from another build is refused, not guessed at. */
export const RESULTS_VERSION = 1;

export type CaptureRecord = {
	file: string;
	axis: Axis;
	dir: "+" | "-";
	rep: number;
	fit: Mode | NoFit;
	tStop: Seconds | null;
};

export type ToolResults = {
	readonly tool: number;
	readonly fingerprint: Fingerprint | null;
	readonly captures: readonly CaptureRecord[];
	readonly sweep: SweepMatrix | null;
	readonly candidates: readonly Candidate[];
	readonly verified: readonly VerifiedCandidate[];
	readonly applied: ShaperSpec | null;
};

/** One file per tool: a toolchanger tunes each head separately, and a shared file would make tool 3's session overwrite tool 0's. */
export const RESULTS_PATH = (tool: number): string => `0:/sys/dwc-ng/shaping/tool${tool}.json`;

export function emptyResults(tool: number): ToolResults {
	return { tool, fingerprint: null, captures: [], sweep: null, candidates: [], verified: [], applied: null };
}

const NO_FIT_REASONS: readonly NoFit["reason"][] = ["short-window", "below-floor", "short-decay", "damping-out-of-range"];

const isFinitePositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function numberArray(raw: unknown, ok: (n: number) => boolean = Number.isFinite): number[] | null {
	if (!Array.isArray(raw)) return null;
	const out: number[] = [];
	for (const v of raw) {
		if (typeof v !== "number" || !ok(v)) return null;
		out.push(v);
	}
	return out;
}

function parseSpec(raw: unknown): ShaperSpec | null {
	if (!isPlainObject(raw) || typeof raw.type !== "string") return null;
	if (raw.type === "custom") {
		const H = numberArray(raw.H, (n) => n > 0);
		const T = numberArray(raw.T, (n) => n > 0);
		if (H === null || T === null || H.length === 0 || H.length !== T.length) return null;
		// The same contract impulses() enforces, checked here so a hand-edited
		// file surfaces as "not a results file" rather than as a thrown
		// RangeError from inside the ranking.
		if (!(H.reduce((a, b) => a + b, 0) < 1)) return null;
		for (let i = 1; i < T.length; i++) if (!(T[i]! > T[i - 1]!)) return null;
		return { type: "custom", H, T: T.map(seconds) };
	}
	if (!SHAPER_TYPES.includes(raw.type as ShaperType)) return null;
	if (!isFinitePositive(raw.F)) return null;
	if (typeof raw.S !== "number" || !Number.isFinite(raw.S) || raw.S < 0) return null;
	return { type: raw.type as ShaperType, F: hz(raw.F), S: raw.S };
}

function parseFit(raw: unknown): Mode | NoFit | null {
	if (!isPlainObject(raw)) return null;
	// The two arms are told apart the same way isMode() tells them apart: a
	// NoFit carries a reason, a Mode carries a damping ratio.
	if (raw.reason === undefined) return reviveMode(raw);
	if (typeof raw.reason !== "string" || !NO_FIT_REASONS.includes(raw.reason as NoFit["reason"])) return null;
	const out: { reason: NoFit["reason"]; f?: Hz; peakG?: G; cyclesFit?: number } = { reason: raw.reason as NoFit["reason"] };
	if (raw.f !== undefined) {
		if (!isFinitePositive(raw.f)) return null;
		out.f = hz(raw.f);
	}
	if (raw.peakG !== undefined) {
		if (typeof raw.peakG !== "number" || !Number.isFinite(raw.peakG) || raw.peakG < 0) return null;
		out.peakG = g(raw.peakG);
	}
	// How short "short-decay" actually was. A near-miss (1.9 of the 2 cycles
	// the fit needs) reads very differently from a mode that dies at once,
	// so it survives the round trip through the card file.
	if (raw.cyclesFit !== undefined) {
		if (typeof raw.cyclesFit !== "number" || !Number.isFinite(raw.cyclesFit) || raw.cyclesFit < 0) return null;
		out.cyclesFit = raw.cyclesFit;
	}
	return out;
}

function parseCaptures(raw: unknown): CaptureRecord[] | null {
	if (!Array.isArray(raw)) return null;
	const out: CaptureRecord[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry)) return null;
		if (typeof entry.file !== "string" || entry.file.length === 0) return null;
		if (entry.axis !== "X" && entry.axis !== "Y") return null;
		if (entry.dir !== "+" && entry.dir !== "-") return null;
		if (!isIndex(entry.rep)) return null;
		const fit = parseFit(entry.fit);
		if (fit === null) return null;
		let tStop: Seconds | null = null;
		if (entry.tStop !== null) {
			if (typeof entry.tStop !== "number" || !Number.isFinite(entry.tStop) || entry.tStop < 0) return null;
			tStop = seconds(entry.tStop);
		}
		out.push({ file: entry.file, axis: entry.axis, dir: entry.dir, rep: entry.rep, fit, tStop });
	}
	return out;
}

function parseSweep(raw: unknown): SweepMatrix | null {
	if (!isPlainObject(raw)) return null;
	const speeds = numberArray(raw.speeds, (n) => Number.isFinite(n) && n > 0);
	const freqs = numberArray(raw.freqs);
	const amps = numberArray(raw.amps);
	const fullStepHz = numberArray(raw.fullStepHz, (n) => Number.isFinite(n) && n >= 0);
	if (speeds === null || freqs === null || amps === null || fullStepHz === null) return null;
	if (fullStepHz.length !== speeds.length) return null;
	if (amps.length !== speeds.length * freqs.length) return null;
	if (typeof raw.maxHz !== "number" || !Number.isFinite(raw.maxHz) || raw.maxHz < 0) return null;
	return {
		speeds: speeds.map(mmPerS),
		freqs: Float64Array.from(freqs),
		amps: Float64Array.from(amps),
		fullStepHz: fullStepHz.map(hz),
		maxHz: raw.maxHz,
	};
}

function parseCandidates(raw: unknown, fingerprint: Fingerprint | null): Candidate[] | null {
	if (!Array.isArray(raw)) return null;
	if (raw.length === 0) return [];
	// A score is a spec measured against a fingerprint. Without one there is
	// nothing to re-derive, and a candidate list carried without its baseline
	// is exactly the stale-copy failure this boundary exists to prevent.
	if (fingerprint === null) return null;
	const out: Candidate[] = [];
	for (const entry of raw) {
		const spec = parseSpec(entry);
		if (spec === null) return null;
		out.push(candidateFor(spec, fingerprint));
	}
	return out;
}

function parseVerified(raw: unknown, baseline: Fingerprint | null): VerifiedCandidate[] | null {
	if (!Array.isArray(raw)) return null;
	if (raw.length === 0) return [];
	if (baseline === null) return null;
	const out: VerifiedCandidate[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry)) return null;
		const spec = parseSpec(entry.spec);
		const measuredFp = reviveFingerprint(entry.fingerprint);
		if (spec === null || measuredFp === null) return null;
		out.push(verifyAnalysis(baseline, candidateFor(spec, baseline), measuredFp));
	}
	return out;
}

/** The exact bytes written to the card. Derived fields are omitted, not duplicated. */
export function serializeResults(results: ToolResults): string {
	return JSON.stringify({
		version: RESULTS_VERSION,
		tool: results.tool,
		fingerprint: results.fingerprint,
		captures: results.captures.map((c) => ({ file: c.file, axis: c.axis, dir: c.dir, rep: c.rep, fit: c.fit, tStop: c.tStop })),
		sweep:
			results.sweep === null
				? null
				: {
						speeds: [...results.sweep.speeds],
						freqs: Array.from(results.sweep.freqs),
						amps: Array.from(results.sweep.amps),
						fullStepHz: [...results.sweep.fullStepHz],
						maxHz: results.sweep.maxHz,
					},
		candidates: results.candidates.map((c) => c.spec),
		verified: results.verified.map((v) => ({ spec: v.spec, fingerprint: v.fingerprint })),
		applied: results.applied,
	});
}

/**
 * Card text → results, or null. Total: no input throws, and no partially
 * trusted result is ever returned.
 */
export function parseResults(text: string): ToolResults | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isPlainObject(raw)) return null;
	if (raw.version !== RESULTS_VERSION) return null;
	if (!isIndex(raw.tool)) return null;

	// A missing key is a refusal, not a default: every field this build writes
	// is always written, so an absent one means the file came from somewhere
	// else.
	const fingerprint = raw.fingerprint === null ? null : reviveFingerprint(raw.fingerprint);
	if (raw.fingerprint !== null && fingerprint === null) return null;

	const captures = parseCaptures(raw.captures);
	if (captures === null) return null;

	const sweep = raw.sweep === null ? null : parseSweep(raw.sweep);
	if (raw.sweep !== null && sweep === null) return null;
	if (raw.sweep === undefined) return null;

	const candidates = parseCandidates(raw.candidates, fingerprint);
	if (candidates === null) return null;

	const verified = parseVerified(raw.verified, fingerprint);
	if (verified === null) return null;

	const applied = raw.applied === null ? null : parseSpec(raw.applied);
	if (raw.applied !== null && applied === null) return null;
	if (raw.applied === undefined) return null;

	return { tool: raw.tool, fingerprint, captures, sweep, candidates, verified, applied };
}
