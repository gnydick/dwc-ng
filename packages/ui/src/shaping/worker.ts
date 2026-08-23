/**
 * Shaping engine worker: fits, rankings and sweeps run off the main thread.
 * Same conventions as gcode/parseGcode.worker.ts — `self` typed by a local
 * cast (the app's lib has no "WebWorker"), results posted with transferable
 * buffers where there are any. Requests carry an id; responses echo it.
 */
import { type Artefact, newPeaks } from "./engine/artefact.ts";
import { type Capture, detectStop, parseCapture, type ParseError } from "./engine/capture.ts";
import { type Axis, type Fingerprint, fitDecay, isMode, type Mode, type NoFit } from "./engine/fit.ts";
import { type Candidate, rank, type RankOptions } from "./engine/rank.ts";
import { type SweepMatrix, sweepMatrix } from "./engine/sweep.ts";
import type { Hz, MmPerS, Seconds } from "./engine/units.ts";

/**
 * One capture, fitted. The samples, the stop the fitter used and the verdict
 * it reached travel as ONE value, and the value names the axis it is about.
 *
 * That is deliberate rather than convenient: the decay chart draws the samples
 * and prints the verdict, and if those arrived as separate arguments a caller
 * could — eventually would — hand it one capture's numbers beside another
 * capture's fit, or draw Y while printing the fit of X. There is nothing to
 * mismatch when there is only one argument.
 */
export type FitResult = {
	/** Which axis `fit` is about, and therefore which of x/y the chart draws. */
	readonly axis: Axis;
	readonly rate: Hz;
	readonly x: Float64Array;
	readonly y: Float64Array;
	readonly z: Float64Array;
	readonly tStop: Seconds | null;
	readonly fit: Mode | NoFit;
};

/**
 * One row of a sweep request: a capture as TEXT, the speed the move was made
 * at, how long that move took, and which of the three accelerometer channels
 * to transform.
 *
 * The axis travels with the row rather than with the request, because a sweep
 * is a set of captures and nothing stops a future caller mixing axes in one
 * picture; `SweepRow` in the engine already takes it per row for that reason.
 */
export type SweepRequestRow = {
	readonly speed: MmPerS;
	readonly csv: string;
	readonly moveS: Seconds;
	/** 0 = X, 1 = Y, 2 = Z. Absent reads X, as `sweepMatrix` defines it. */
	readonly axis?: 0 | 1 | 2;
};

export type EngineRequest = { readonly id: number } & (
	| { readonly kind: "fit"; readonly csv: string; readonly axis: Axis }
	| { readonly kind: "rank"; readonly fp: Fingerprint; readonly opts?: RankOptions }
	| { readonly kind: "sweep"; readonly rows: ReadonlyArray<SweepRequestRow>; readonly fullStepsPerMm: number; readonly maxHz?: number }
	| { readonly kind: "artefact"; readonly baseline: Fingerprint; readonly verified: Fingerprint }
);

export type EngineResult =
	| { readonly kind: "fit"; readonly result: FitResult }
	| { readonly kind: "rank"; readonly result: Candidate[] }
	| { readonly kind: "sweep"; readonly result: SweepMatrix }
	| { readonly kind: "artefact"; readonly result: Artefact[] };

export type EngineResponse = { readonly id: number } & (EngineResult | { readonly kind: "error"; readonly error: string });

interface WorkerSelf {
	onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
	postMessage(message: EngineResponse, transfer: Transferable[]): void;
}

function parsed(csv: string): Capture {
	const r = parseCapture(csv);
	if (!r.ok) throw new Error(describe(r.error));
	return r.capture;
}

export function describe(e: ParseError): string {
	switch (e.kind) {
		case "no-trailer":
			return "capture has no 'Rate N, overflows M' trailer (incomplete download?)";
		case "overflows":
			return `capture has ${e.count} accelerometer overflows — repeat it`;
		case "no-samples":
			return "capture has no samples";
		default: {
			const unhandled: never = e;
			return String(unhandled);
		}
	}
}

export function handle(req: EngineRequest): { response: EngineResponse; transfer: Transferable[] } {
	try {
		switch (req.kind) {
			case "fit": {
				const c = parsed(req.csv);
				const data = req.axis === "X" ? c.x : c.y;
				const tStop = detectStop(data, c.rate);
				const fit: Mode | NoFit = tStop === null ? { reason: "short-window" } : fitDecay(data, c.rate, tStop);
				const result: FitResult = { axis: req.axis, rate: c.rate, x: c.x, y: c.y, z: c.z, tStop, fit };
				void isMode;
				return { response: { id: req.id, kind: "fit", result }, transfer: [c.x.buffer, c.y.buffer, c.z.buffer] };
			}
			case "rank":
				return { response: { id: req.id, kind: "rank", result: rank(req.fp, req.opts) }, transfer: [] };
			case "sweep": {
				// `axis` is forwarded rather than defaulted here: a Y-axis sweep
				// analysed against the X channel would be a plot of the wrong
				// carriage, and the only place that knows which axis a capture is
				// of is the caller that chose the files.
				const rows = req.rows.map((r) => ({ speed: r.speed, capture: parsed(r.csv), moveS: r.moveS, axis: r.axis }));
				const result = sweepMatrix(rows, req.fullStepsPerMm, req.maxHz);
				return { response: { id: req.id, kind: "sweep", result }, transfer: [result.amps.buffer, result.freqs.buffer] };
			}
			case "artefact":
				return { response: { id: req.id, kind: "artefact", result: newPeaks(req.baseline, req.verified) }, transfer: [] };
			default: {
				const unhandled: never = req;
				throw new Error(`unknown request ${String((unhandled as { kind: unknown }).kind)}`);
			}
		}
	} catch (err) {
		return { response: { id: req.id, kind: "error", error: err instanceof Error ? err.message : String(err) }, transfer: [] };
	}
}

if (typeof self !== "undefined" && "postMessage" in self && typeof document === "undefined") {
	const ctx = self as unknown as WorkerSelf;
	ctx.onmessage = (event: MessageEvent<EngineRequest>) => {
		const { response, transfer } = handle(event.data);
		ctx.postMessage(response, transfer);
	};
}
