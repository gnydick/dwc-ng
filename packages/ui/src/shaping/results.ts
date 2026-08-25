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
import type { Conditions, Provenance } from "./evidence/evidence.ts";
import type { SweepMatrix } from "./engine/sweep.ts";
import { g, type G, hz, type Hz, mmPerS, type Seconds, seconds } from "./engine/units.ts";
import { type VerifiedCandidate, verifyAnalysis } from "./store.ts";

/**
 * Bumped when the wire shape changes; a file from another build is refused,
 * not guessed at.
 *
 * **2 (#53)** — the shape did not change. What changed is whether the numbers
 * inside can be believed. Every version-1 file was written by a build whose
 * ring and sweep plans sent no `M593` at all, so its fingerprint was recorded
 * through whatever shaper `tpost<N>.g` had installed. On the one machine we
 * have evidence from that was `M593 P"ei2" F52 S0.034`, and the fingerprint it
 * produced was of the suppressed machine — both axes converging on ~15 Hz,
 * indistinguishable from a real reading.
 *
 * There is deliberately no `measuredThrough` field recording the shaper
 * instead. A field is a CLAIM, and a version-1 file has no claim to make; the
 * guarantee this version asserts comes from the code path that wrote it
 * (`stepsFor` now states a shaper for every plan kind, armed with `never`),
 * which cannot be forged by a file. Giving a fingerprint an identity it can
 * carry across builds is #57's job, and it needs more than one field.
 *
 * The cost is understood and accepted: a board holding version-1 results loses
 * its cached fingerprint, sweep and capture list, and the operator re-measures.
 * The CSVs on the card are untouched. Silently loading a fingerprint of a
 * shaped machine is the failure this whole ticket exists to end — the numbers
 * looked fine, which is exactly why refusing them has to be automatic.
 *
 * **3 (#57)** — the shape DID change, and this is the version #53 said would
 * need more than one field. `fingerprint` and `captures` are gone as loose
 * keys; in their place is one `measurement` object carrying both plus a
 * `provenance` that says where they came from and, for a real run, the machine
 * state they were taken under: the shaper the run stated, the acceleration it
 * planned against, the speed, the distance and the repeats. A version-2 file
 * has no honest answer to any of that. It could be read as
 * `provenance: unknown`, and that was considered and rejected: the operator
 * would then see "this cannot be checked" over numbers that in every case we
 * have evidence of WERE checkable — they came off a build that already sent
 * `M593 P"none"` — and a warning that fires on good data is the failure mode
 * `axes-agree` was written under. Refusing is one re-measure; a permanently
 * unattributable card is a warning nobody reads.
 *
 * The cost is the same as version 2's and accepted for the same reason: the
 * CSVs on the card are untouched, and the run that rebuilds the file takes a
 * few minutes and produces something that can answer the question.
 */
export const RESULTS_VERSION = 3;

export type CaptureRecord = {
	file: string;
	axis: Axis;
	dir: "+" | "-";
	rep: number;
	fit: Mode | NoFit;
	tStop: Seconds | null;
};

/**
 * A fingerprint, the captures it is the median of, and where all of it came
 * from — ONE value, and #57's whole answer.
 *
 * Gabe, 2026-08-23, reading `tool0.json`: "is there some sort of session
 * there? because there's no notion of session for the UI." The file held three
 * loose fields — a fingerprint, an array of captures and nothing at all about
 * their origin — and a reader could only assume they belonged together. They
 * did not have to. `fitCaptures` aggregated whatever the operator had ticked,
 * so a shaping-off baseline and a verify capture recorded through `ei2 F52`
 * both parsed as `X+0` and `X-0`, both fitted, and landed in one median that
 * described neither machine.
 *
 * Bundling them is not tidiness, it is the mechanism. "Kept beside each other
 * so they cannot drift" prevents nothing; being one value does. There is no
 * longer a spelling for a fingerprint without its provenance, for captures
 * belonging to no fingerprint, or for a provenance describing a measurement
 * that is not there — the three states `setFingerprint` plus N `addCapture`s
 * could produce, which is why both of those setters are gone.
 *
 * @invariant a-fingerprint-cannot-be-held-without-saying-where-it-came-from
 * @rung 8  illegal state unrepresentable — provenance is a required field of
 *          the same object as the fingerprint, and `Provenance` is a total
 *          union with no absent arm. A caller who read nothing still has to
 *          write down an origin to construct one, and the honest answers for
 *          the cases that have no conditions (`assembled`, `loaded`,
 *          `unknown`) are arms of the union rather than an omission
 * @why the numbers in this record end up as the `M593` line written into
 *      `tpost<N>.g`. A measurement that cannot say what machine state it
 *      describes is one an operator tunes a printer against on trust
 */
export type Measurement = {
	readonly fingerprint: Fingerprint;
	readonly captures: readonly CaptureRecord[];
	readonly provenance: Provenance;
};

export type ToolResults = {
	readonly tool: number;
	readonly measurement: Measurement | null;
	readonly sweep: SweepMatrix | null;
	readonly candidates: readonly Candidate[];
	readonly verified: readonly VerifiedCandidate[];
	readonly applied: ShaperSpec | null;
};

/** The fingerprint, or null where nothing has been measured. Present because
 *  the great majority of readers want exactly this, and writing the optional
 *  chain at each of them is how a `?? null` eventually becomes a `!`. */
export const fingerprintOf = (r: ToolResults): Fingerprint | null => r.measurement?.fingerprint ?? null;

/** The captures, or none. Same reason as `fingerprintOf`. */
export const capturesOf = (r: ToolResults): readonly CaptureRecord[] => r.measurement?.captures ?? [];

/** One file per tool: a toolchanger tunes each head separately, and a shared file would make tool 3's session overwrite tool 0's. */
export const RESULTS_PATH = (tool: number): string => `0:/sys/dwc-ng/shaping/tool${tool}.json`;

/**
 * Every directory a path needs, outermost first, excluding the volume.
 *
 * `0:/sys/dwc-ng/shaping/tool0.json` needs `0:/sys`, `0:/sys/dwc-ng` and
 * `0:/sys/dwc-ng/shaping` to exist. RRF does not create them: `rr_upload` to a
 * missing directory fails, and DWC only ever calls `rr_mkdir` from its explicit
 * New Directory dialog (reference/connectors PollConnector.ts:953). Nobody had
 * noticed because `save` had no call site until a real fingerprint needed
 * writing — on a board where `0:/sys/dwc-ng/` does not exist.
 */
export function parentDirs(path: string): string[] {
	const parts = path.split("/");
	// The volume prefix ("0:") is not a directory anyone creates, and the last
	// segment is the file itself.
	const dirs: string[] = [];
	for (let i = 2; i < parts.length; i++) {
		dirs.push(parts.slice(0, i).join("/"));
	}
	return dirs;
}

export function emptyResults(tool: number): ToolResults {
	return { tool, measurement: null, sweep: null, candidates: [], verified: [], applied: null };
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

/**
 * The conditions half of a `measured` provenance, rebuilt field by field.
 *
 * Every number is required and every number is checked for the sign its
 * meaning demands: a zero acceleration is not a machine, a zero distance is
 * not a move, and a zero repeat count is not a measurement. A card file
 * carrying any of them is describing a run that did not happen, and the whole
 * point of recording conditions is that they can be COMPARED — a nonsense
 * acceleration would supersede every real one it was checked against.
 *
 * `shaper` is `null` or a spec, and it goes through `parseSpec`, the same gate
 * `applied` and every candidate uses. A hand-written shaper here cannot be a
 * shape the ranking would throw on.
 */
function parseConditions(raw: unknown): Conditions | null {
	if (!isPlainObject(raw)) return null;
	if (!isFinitePositive(raw.accelMmPerS2) || !isFinitePositive(raw.speedMmPerS) || !isFinitePositive(raw.distMm)) return null;
	if (!isIndex(raw.repeats) || raw.repeats === 0) return null;
	if (raw.shaper === undefined) return null;
	const shaper = raw.shaper === null ? null : parseSpec(raw.shaper);
	if (raw.shaper !== null && shaper === null) return null;
	return {
		shaper,
		accelMmPerS2: raw.accelMmPerS2,
		speedMmPerS: raw.speedMmPerS,
		distMm: raw.distMm,
		repeats: raw.repeats,
	};
}

/**
 * Where a measurement came from, as the card spells it.
 *
 * Total over the union and REFUSING on an unrecognised kind rather than
 * falling back to `unknown`, which is the one tempting mistake here. Falling
 * back would mean a typo in the file — or a provenance written by a future
 * build this one cannot read — silently becoming "this cannot be checked" over
 * numbers that are then used anyway. The rest of this module refuses the whole
 * file when a field is wrong, for exactly the reason `parseResults` states,
 * and an origin is not a lesser field than a frequency.
 *
 * The `unknown` arm is still parsed, because it is a legitimate thing to have
 * written: `assembled` and `unknown` are what an operator's own hand-gathered
 * captures come back as, and #57 is explicit that those stay usable.
 */
function parseProvenance(raw: unknown): Provenance | null {
	if (!isPlainObject(raw) || typeof raw.kind !== "string") return null;
	switch (raw.kind) {
		case "measured": {
			if (typeof raw.at !== "string" || raw.at.length === 0) return null;
			const under = parseConditions(raw.under);
			if (under === null) return null;
			return { kind: "measured", at: raw.at, under };
		}
		case "assembled":
			if (!isIndex(raw.n)) return null;
			return { kind: "assembled", n: raw.n };
		case "loaded":
			if (typeof raw.path !== "string" || raw.path.length === 0) return null;
			return { kind: "loaded", path: raw.path };
		case "unknown":
			if (typeof raw.why !== "string" || raw.why.length === 0) return null;
			return { kind: "unknown", why: raw.why };
		default:
			return null;
	}
}

/** The three-in-one, refused whole: a fingerprint the fitter would not have
 *  produced, a bad capture or an unreadable origin all mean this is not a
 *  measurement, and there is no half of one worth keeping. */
function parseMeasurement(raw: unknown): Measurement | null {
	if (!isPlainObject(raw)) return null;
	const fingerprint = reviveFingerprint(raw.fingerprint);
	if (fingerprint === null) return null;
	const captures = parseCaptures(raw.captures);
	if (captures === null) return null;
	const provenance = parseProvenance(raw.provenance);
	if (provenance === null) return null;
	return { fingerprint, captures, provenance };
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
		// The whole measurement or nothing. Its three parts are written under
		// one key because they are one value: a reader that found a
		// fingerprint here without a provenance beside it would be reading a
		// file this build cannot have produced.
		measurement:
			results.measurement === null
				? null
				: {
						fingerprint: results.measurement.fingerprint,
						captures: results.measurement.captures.map((c) => ({ file: c.file, axis: c.axis, dir: c.dir, rep: c.rep, fit: c.fit, tStop: c.tStop })),
						provenance: results.measurement.provenance,
					},
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
	const measurement = raw.measurement === null ? null : parseMeasurement(raw.measurement);
	if (raw.measurement !== null && measurement === null) return null;
	if (raw.measurement === undefined) return null;
	const fingerprint = measurement?.fingerprint ?? null;

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

	return { tool: raw.tool, measurement, sweep, candidates, verified, applied };
}
