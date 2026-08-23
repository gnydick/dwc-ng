/**
 * Every capture this session has fitted, by file name — the difference between
 * a browser that remembers what it has looked at and one that forgets whenever
 * you touch it.
 *
 * A fit is a PURE FUNCTION of a capture file's bytes: `parseCapture` →
 * `detectStop` → `fitDecay`, with no clock, no machine state and no tool in it.
 * Two runs over the same file cannot disagree, so there is never a correctness
 * reason to discard one — while every discarded fit costs a download out of an
 * embedded HTTP server plus an FFT.
 *
 * @invariant fits-are-dropped-only-by-a-reload
 * @rung 7  sole-constructor type — the returned object exposes `remember` and
 *          `forget` and nothing else; the Map is closed over and unreachable.
 *          There is no setter, no `clear(file)`, and no way to hand the cache a
 *          replacement, so the only code that can empty it is code that names
 *          `forget`, and that is `reload` alone. A selection change, a tool
 *          change or a failed batch cannot empty it because they have nothing
 *          to call
 * @why reported by Gabe, 2026-08-23: fit the twelve `ring1_` captures, click
 *      the `ring1_v_` chip, and every fit was gone. The fits had been derived
 *      from `runState`, which `clearRun` resets on every selection change —
 *      correctly, because "fitted 12 of 12" beside a changed set of ticks is a
 *      stale CLAIM. The numbers are not a claim about the selection, so they
 *      had no business living in the same value
 * @limit session only, and deliberately: a cached fit is not a measurement
 *        anybody asked to keep. The results file is where a measurement is
 *        kept, against a named tool and through an armed confirm, and writing
 *        cache entries there would recreate exactly the manufactured-state
 *        problem that boundary exists to prevent
 */
import type { Mode, NoFit } from "./engine/fit.ts";

export type FitCache = {
	/** What this session made of `file`, or undefined if it has never looked. */
	get(file: string): Mode | NoFit | undefined;
	/** Everything fitted so far. A new object per change, so a Solid signal
	 *  holding one notifies on `remember`. */
	all(): ReadonlyMap<string, Mode | NoFit>;
	/** Record one fit. Recording the same file twice is defined and identical —
	 *  the input decides the output — so a re-fit is free rather than a
	 *  conflict. */
	remember(file: string, fit: Mode | NoFit): void;
	/**
	 * Drop everything. The ONLY route out, and it exists for one gesture: the
	 * Shaping screen's Reload, which means "the card is not what I last read".
	 * Re-running a capture under a name that already exists is the ordinary way
	 * these files change, so a reload that kept the fits would show yesterday's
	 * ring-down under today's file name.
	 */
	forget(): void;
};

/**
 * A cache, and a signal-friendly accessor over it.
 *
 * `onChange` is how this stays usable from a reactive card without the cache
 * itself knowing what Solid is: the service hands in its setter, the cache
 * hands back the new map. Unbounded on purpose — the whole directory is 276
 * files and a fit is five numbers, so a cap would cost more thought than the
 * memory it saved.
 */
export function createFitCache(onChange: (fits: ReadonlyMap<string, Mode | NoFit>) => void = () => undefined): FitCache {
	let fits = new Map<string, Mode | NoFit>();
	return {
		get: (file: string): Mode | NoFit | undefined => fits.get(file),
		all: (): ReadonlyMap<string, Mode | NoFit> => fits,
		remember: (file: string, fit: Mode | NoFit): void => {
			// Replaced rather than mutated: the map is what a signal holds, and a
			// mutated Map is a value Solid has no way to see has changed.
			fits = new Map(fits).set(file, fit);
			onChange(fits);
		},
		forget: (): void => {
			fits = new Map();
			onChange(fits);
		},
	};
}
