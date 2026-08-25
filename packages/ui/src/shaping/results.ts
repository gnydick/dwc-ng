/**
 * What a tool's shaping results ARE: the measurement, its provenance, the
 * candidates ranked against it, and where on the card the whole thing lives.
 *
 * The SHAPE, not the FORMAT. Reading and writing the file is
 * shaping/resultsCodec.ts, and the two are apart on purpose: every screen in
 * the app composes against `compose/services.ts`, which is eager and which
 * needs `emptyResults`, `RESULTS_PATH` and `fingerprintOf` — three lines
 * describing what a measurement is. It has no use for a JSON parser, and while
 * the parser sat in this module it was on the critical path of every cold load
 * anyway. #57's provenance parsing is what made that visible: it pushed the
 * eager payload 579 B past its ceiling and the parser had never belonged there.
 *
 * The consequence to notice is that this module now has NO runtime imports at
 * all — every remaining one is `import type`, erased at compile time. That is
 * the property worth keeping: a value import added here is a byte added to
 * every board load, and it also re-opens the results.ts ⇄ store.ts import cycle
 * that the split closed.
 */
import type { Axis, Fingerprint, Mode, NoFit } from "./engine/fit.ts";
import type { Candidate } from "./engine/rank.ts";
import type { ShaperSpec } from "./engine/shapers.ts";
import type { Provenance } from "./evidence/evidence.ts";
import type { SweepMatrix } from "./engine/sweep.ts";
import type { Seconds } from "./engine/units.ts";
import type { VerifiedCandidate } from "./store.ts";

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

