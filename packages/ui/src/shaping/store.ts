/**
 * The per-tool shaping results, in memory and on the card, and the one place a
 * candidate can become a VERIFIED candidate.
 *
 * Two invariants live here.
 *
 * @invariant verified-is-a-type
 * @rung 7  sole-constructor type — `VerifiedCandidate` carries a brand keyed by
 *          a `unique symbol` that this module declares and does not export.
 *          Outside this file the key cannot be NAMED, so no object literal,
 *          spread, `satisfies` or structural widening produces one: the type is
 *          reachable only by calling verifyAnalysis(), which needs a baseline
 *          Fingerprint, a Candidate and a measured Fingerprint — each itself
 *          mintable only by its own engine module. "This shaper was measured on
 *          the machine" therefore cannot be asserted, only earned
 * @why the Apply card's whole job is the difference between "the impulse model
 *      predicts this is good" and "the machine was measured with it on". The
 *      2026-08-22 prototype found a shaper the model rated best that introduced
 *      a NEW 38 Hz ring — a predicted-good candidate is not a verified one, and
 *      a boolean field saying `verified: true` would let any code claim it was
 * @limit a TypeScript brand is defeated by an explicit `as VerifiedCandidate`
 *        or a trip through `any`; the language has no stronger seal. That
 *        residue is what test/shaping-motion-fence.test.ts backstops — it is a
 *        BACKSTOP for the cast, not the mechanism for the type
 *
 * @invariant results-persist-through-one-writer
 * @rung 6  choke-point — RESULTS_PATH is imported by this module alone, so the
 *          card file has exactly one reader (load) and one writer (save), and
 *          both go through parseResults/serializeResults. `save` also creates
 *          the directory chain the path needs, so "wrote the file" and "the
 *          place it goes exists" are one act rather than a precondition on
 *          whoever calls it
 * @why per-tool results written from two places would interleave a half-built
 *      session over a finished one, and a reader that skipped parseResults
 *      would put hand-edited numbers straight into a ranking
 * @debt the path is a plain string (see results.ts); promote by branding it so
 *       a second writer cannot address the file at all. Tracked on GitHub #19.
 */
import { type Accessor, createSignal } from "solid-js";
import { createStore, type Store, unwrap } from "solid-js/store";
import type { ConnectorReads, ConnectorWrites } from "@dwc-ng/connector";
import { newPeaks, type Artefact } from "./engine/artefact.ts";
import type { Fingerprint } from "./engine/fit.ts";
import type { Candidate } from "./engine/rank.ts";
import type { ShaperSpec } from "./engine/shapers.ts";
import type { SweepMatrix } from "./engine/sweep.ts";
import { emptyResults, type Measurement, parentDirs, RESULTS_PATH, type ToolResults } from "./results.ts";

/**
 * The results-file codec, fetched the first time a file is actually read or
 * written and shared by both callers thereafter.
 *
 * DYNAMIC, and this is the one place in the app that may say so. The parser and
 * the serializer are ~3 KB of hostile-input validation that runs exactly twice
 * per tool per session — once inside `load`, once inside `save` — and both of
 * those were already awaiting a round trip to the board. Statically imported
 * they rode on every cold load instead, for screens that never touch a results
 * file; see the header of resultsCodec.ts for the measurement that found it.
 *
 * A rejected fetch clears the memo rather than being cached forever: a codec
 * that failed to load once because the connection dropped must not make every
 * later load fail with a stale rejection.
 */
type ResultsCodec = typeof import("./resultsCodec.ts");
let codec: Promise<ResultsCodec> | null = null;
const resultsCodec = (): Promise<ResultsCodec> =>
	(codec ??= import("./resultsCodec.ts").catch((e: unknown) => {
		codec = null;
		throw e;
	}));

// Declared, never exported, and with no runtime value: the brand exists only
// in the type system, which is exactly where the guarantee is needed.
declare const __verified: unique symbol;

export type VerifiedCandidate = Candidate & {
	readonly [__verified]: true;
	/** Post-shaping peak as a fraction of the baseline peak, per axis. 0 = the ring is gone. */
	readonly measured: { X?: number; Y?: number };
	readonly artefacts: readonly Artefact[];
	/**
	 * Axes the artefact check could not judge, because the baseline has no mode
	 * on them.
	 *
	 * NOT the same as "no artefacts", and kept apart from it for the reason the
	 * whole findings layer exists: an empty artefact list on an unjudged axis
	 * means nothing was checked, and a card that showed it as a clean result
	 * would be recommending a shaper on the strength of a test that did not run.
	 */
	readonly unjudged: readonly ("X" | "Y")[];
	/** The fingerprint measured WITH the shaper on — the evidence for `measured`. */
	readonly fingerprint: Fingerprint;
};

/**
 * The sole producer of a VerifiedCandidate: compare a fingerprint measured with
 * the shaper applied against the machine's baseline.
 *
 * Everything it reports is derived here rather than accepted from a caller —
 * `measured` from the two peak amplitudes, `artefacts` from newPeaks — so there
 * is no field a caller could pre-fill with a flattering number.
 */
export function verifyAnalysis(baseline: Fingerprint, candidate: Candidate, measuredFingerprint: Fingerprint): VerifiedCandidate {
	const measured: { X?: number; Y?: number } = {};
	for (const axis of ["X", "Y"] as const) {
		const before = baseline[axis];
		// An axis that never rang has no ratio to report; reporting 0 there
		// would read as "the shaper fixed it".
		if (before === null || !(before.peakG > 0)) continue;
		const after = measuredFingerprint[axis];
		measured[axis] = after === null ? 0 : after.peakG / before.peakG;
	}
	// Typed as "a VerifiedCandidate minus the brand", so the assertion below
	// adds the brand and nothing else: a field that drifts out of shape is a
	// compile error here rather than something the cast papers over.
	const analysed: Omit<VerifiedCandidate, typeof __verified> = {
		...candidate,
		measured,
		...(() => {
			const report = newPeaks(baseline, measuredFingerprint);
			return { artefacts: report.artefacts, unjudged: report.unjudged };
		})(),
		fingerprint: measuredFingerprint,
	};
	return analysed as VerifiedCandidate;
}

export type ShapingStore = {
	/** Results by tool number. A tool with no entry has never been loaded. */
	readonly results: Store<Record<number, ToolResults>>;
	readonly loading: Accessor<boolean>;
	/** Empty unless the card held a file this build could not read. */
	readonly error: Accessor<string>;
	load(tool: number): Promise<void>;
	save(tool: number): Promise<void>;
	/**
	 * A whole measurement in one act: the fingerprint, the captures it was
	 * aggregated from, and where they came from — replacing whatever the tool
	 * had.
	 *
	 * ONE argument, and it is the whole point rather than an ergonomic. This
	 * used to sit beside `setFingerprint(tool, fp | null)` and
	 * `addCapture(tool, one)`, which between them could put a fingerprint in
	 * the store with nobody's captures under it, captures under no fingerprint,
	 * and — once #57 gave a measurement an origin — numbers with no origin at
	 * all. Neither had a caller outside the tests. They are gone, and
	 * `Measurement` being one value is what makes their absence permanent: this
	 * is the only door, and it does not open without a provenance.
	 *
	 * Captures REPLACE rather than append: a fingerprint run is the tool's
	 * measurement, not an addition to a previous one.
	 */
	setMeasurement(tool: number, measurement: Measurement): void;
	setSweep(tool: number, sweep: SweepMatrix | null): void;
	setCandidates(tool: number, candidates: readonly Candidate[]): void;
	addVerified(tool: number, verified: VerifiedCandidate): void;
	setApplied(tool: number, applied: ShaperSpec | null): void;
	/** Drop everything measured for a tool, back to the never-measured state. */
	clear(tool: number): void;
};

/** The connector surface this store needs: reads, plus the two writes that put
 *  the file on the card — the upload, and the directory it has to land in. */
export type ResultsConnector = ConnectorReads & Pick<ConnectorWrites, "upload" | "mkdir">;

export function createShapingStore(conn: ResultsConnector): ShapingStore {
	const [results, setResults] = createStore<Record<number, ToolResults>>({});
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");

	// A tool entry is written whole rather than by path.
	//
	// Two reasons, and neither is laziness. SweepMatrix holds Float64Arrays,
	// which Solid does not treat as wrappable, so a key-by-key reconcile of a
	// matrix would walk its numeric indices; and a ToolResults is a handful of
	// fields updated at human pace (one capture every few seconds), so the
	// fine-grained notification a path write buys is worth nothing here while
	// the "which paths are legal" typing it costs is real. Wholesale subtree
	// replacement is the project's merge model anyway.
	const patch = (tool: number, change: (current: ToolResults) => Partial<ToolResults>): void => {
		const current = unwrap(results[tool] ?? emptyResults(tool));
		setResults(tool, { ...current, ...change(current) });
	};

	const replace = (tool: number, next: ToolResults): void => {
		setResults(tool, next);
	};

	return {
		results,
		loading,
		error,

		load: async (tool: number): Promise<void> => {
			const path = RESULTS_PATH(tool);
			setLoading(true);
			setError("");
			// The reader comes FIRST and OUTSIDE the try below, because the two
			// failures mean opposite things. The catch below means "this tool
			// has no file", which is the normal state of an unmeasured tool and
			// is deliberately silent. A reader that did not load means this
			// deployment is incomplete, which is never normal — folded into the
			// same catch it would report every tool on the machine as never
			// measured, over a card that may hold a full session.
			let parseResults: ResultsCodec["parseResults"];
			try {
				({ parseResults } = await resultsCodec());
			} catch {
				setError(`${path} could not be read: this build's results-file reader did not load.`);
				setLoading(false);
				return;
			}
			try {
				const parsed = parseResults(await conn.download(path));
				if (parsed === null) {
					// The card has a file and it is not one we can read. Say so:
					// silently showing "never measured" would invite the operator
					// to re-run a session they already have on disk.
					setError(`${path} is not a shaping results file this build understands.`);
					replace(tool, emptyResults(tool));
				} else {
					replace(tool, parsed);
				}
			} catch {
				// No file yet is the normal state for a tool nobody has measured,
				// and the connector cannot distinguish that from a transport
				// failure — the connection status strip is what reports the
				// latter, so this stays quiet rather than crying wolf per tool.
				replace(tool, emptyResults(tool));
			} finally {
				setLoading(false);
			}
		},

		save: async (tool: number): Promise<void> => {
			const current = unwrap(results[tool] ?? emptyResults(tool));
			const path = RESULTS_PATH(tool);
			// The directory chain first. RRF's rr_upload does not create it and
			// `0:/sys/dwc-ng/shaping/` does not exist on a machine that has
			// never saved one — which is every machine, this being the first
			// writer. Each level is attempted and its rejection ignored,
			// because "already exists" and "parent missing" are the same
			// rejection from this API and only the upload can tell us which
			// mattered: if the chain really is absent the upload fails next
			// line, with the error the operator needs to see.
			for (const dir of parentDirs(path)) {
				await conn.mkdir(dir).catch(() => undefined);
			}
			// No swallow to worry about here: `save` reports failure by
			// rejecting, so a writer that did not load surfaces to the operator
			// as a save that did not happen — which is exactly what it is.
			const { serializeResults } = await resultsCodec();
			await conn.upload(path, serializeResults(current));
		},

		setMeasurement: (tool, measurement): void => {
			// Candidates and verified go with it, and that is the honest
			// behaviour rather than tidiness. A Candidate is a spec SCORED
			// against a fingerprint and a VerifiedCandidate is a comparison
			// AGAINST one; carrying either across a new measurement would
			// silently re-interpret it against a baseline it was never measured
			// with. `applied` stays: it records what is on the machine, which a
			// new measurement does not change.
			patch(tool, () => ({ measurement, candidates: [], verified: [] }));
		},
		setSweep: (tool, sweep): void => {
			patch(tool, () => ({ sweep }));
		},
		setCandidates: (tool, candidates): void => {
			patch(tool, () => ({ candidates: [...candidates] }));
		},
		addVerified: (tool, verified): void => {
			patch(tool, (c) => ({ verified: [...c.verified, verified] }));
		},
		setApplied: (tool, applied): void => {
			patch(tool, () => ({ applied }));
		},
		clear: (tool): void => {
			replace(tool, emptyResults(tool));
		},
	};
}
