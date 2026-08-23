/**
 * The shaping engine as seen from the UI: one worker per app, typed calls,
 * id-correlated replies. This is the ONLY `new Worker(...)` site for shaping
 * (the lazy-bundle/structural walkers pin it).
 */
import type { Artefact } from "./engine/artefact.ts";
import type { Axis, Fingerprint } from "./engine/fit.ts";
import type { Candidate, RankOptions } from "./engine/rank.ts";
import type { SweepMatrix } from "./engine/sweep.ts";
import type { MmPerS, Seconds } from "./engine/units.ts";
import { unwrap } from "solid-js/store";
import type { EngineRequest, EngineResponse, EngineResult, FitResult } from "./worker.ts";

export type Engine = {
	fit(csv: string, axis: Axis): Promise<FitResult>;
	rank(fp: Fingerprint, opts?: RankOptions): Promise<Candidate[]>;
	sweep(rows: ReadonlyArray<{ speed: MmPerS; csv: string; moveS: Seconds }>, fullStepsPerMm: number, maxHz?: number): Promise<SweepMatrix>;
	artefact(baseline: Fingerprint, verified: Fingerprint): Promise<Artefact[]>;
	terminate(): void;
};

type Pending = { resolve: (r: EngineResult) => void; reject: (e: Error) => void };

/** Omit distributed over the request union (a plain Omit collapses it). */
type RequestBody = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export function createEngine(spawn: () => Worker = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })): Engine {
	const worker = spawn();
	const pending = new Map<number, Pending>();
	let nextId = 1;
	worker.onmessage = (event: MessageEvent<EngineResponse>) => {
		const msg = event.data;
		const p = pending.get(msg.id);
		if (!p) return;
		pending.delete(msg.id);
		if (msg.kind === "error") p.reject(new Error(msg.error));
		else p.resolve(msg);
	};
	/**
	 * `unwrap` before `postMessage`, and this is load-bearing rather than
	 * defensive.
	 *
	 * Everything the engine is asked about comes out of the results store —
	 * fingerprints to rank, captures to sweep, the two fingerprints an artefact
	 * comparison needs — and a Solid store hands them over as PROXIES. The
	 * structured clone algorithm cannot clone a proxy, so the call rejects with
	 * `DataCloneError: #<Object> could not be cloned` (observed 2026-08-22
	 * driving the status card's Rank button in the Card Lab; the promise
	 * rejected, nothing was ranked, and the failure surfaced only as an
	 * unhandled rejection in the console).
	 *
	 * It lives HERE, at the one place every request passes through, and not at
	 * the call sites: there are four engine methods and every one of them will
	 * eventually be handed something the store owns, so a fix per caller is
	 * three future bugs waiting for whoever writes the next card. `unwrap` is a
	 * no-op on anything that is not a store proxy, so a plain request pays
	 * nothing for it.
	 */
	function send(body: RequestBody): Promise<EngineResult> {
		return new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			worker.postMessage(unwrap({ ...body, id }) as EngineRequest);
		});
	}
	const mismatch = (want: string, got: string): Error => new Error(`engine replied ${got} to a ${want} request`);
	return {
		async fit(csv, axis) {
			const r = await send({ kind: "fit", csv, axis });
			if (r.kind !== "fit") throw mismatch("fit", r.kind);
			return r.result;
		},
		async rank(fp, opts) {
			const r = await send({ kind: "rank", fp, opts });
			if (r.kind !== "rank") throw mismatch("rank", r.kind);
			return r.result;
		},
		async sweep(rows, fullStepsPerMm, maxHz) {
			const r = await send({ kind: "sweep", rows, fullStepsPerMm, maxHz });
			if (r.kind !== "sweep") throw mismatch("sweep", r.kind);
			return r.result;
		},
		async artefact(baseline, verified) {
			const r = await send({ kind: "artefact", baseline, verified });
			if (r.kind !== "artefact") throw mismatch("artefact", r.kind);
			return r.result;
		},
		terminate: () => {
			worker.terminate();
			for (const p of pending.values()) p.reject(new Error("engine terminated"));
			pending.clear();
		},
	};
}

let shared: Engine | null = null;

/** App-wide engine, created on first use. */
export function useEngine(): Engine {
	shared ??= createEngine();
	return shared;
}
