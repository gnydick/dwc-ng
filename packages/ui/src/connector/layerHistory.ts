/**
 * Client-side layer history for STANDALONE boards (and anything speaking
 * plain rr_): RRF does not keep per-layer statistics — the official DWC
 * synthesizes them in its PollConnector from observed poll data
 * (reference/connectors/src/PollConnector.ts:698 "RRF does not keep track
 * of them", :701-790). This module is our own implementation of that idea,
 * written from the reference's UNDERSTANDING (which edge cases exist),
 * not its code, per the standing reference-only rule.
 *
 * Edge cases the reference teaches:
 * - a print's history starts empty and RESETS when a new print starts;
 * - the layer number can jump several layers between polls — the elapsed
 *   time/filament/bytes are spread as per-layer averages;
 * - the layer number can go DOWN (sequential printing) — the elapsed
 *   stats fold into the highest layer instead of appending;
 * - warm-up time is excluded from the first layer's duration;
 * - connecting mid-print backfills the missed layers as uniform averages
 *   (honest about resolution: the history was not observed).
 *
 * Pure and connector-agnostic: feed it whatever job/move/heat data each
 * poll produced; it answers with the full layers array when it changed,
 * null otherwise. It is the ONE producer of synthesized layers — the
 * connector never computes layer stats anywhere else.
 */
import type { Layer } from "../om/types.ts";

/** What one poll tick tells us — extracted tolerantly by the caller. */
export interface LayerObservation {
	/** null = not printing (job.duration is null between prints). */
	duration: number | null;
	layer: number | null;
	warmUpDuration: number | null;
	filePosition: number | null;
	fileSize: number | null;
	/** Z axis user position, for layer-height estimates. */
	zPosition: number | null;
	/** Per-extruder cumulative raw extrusion (rawPosition), mm. */
	rawExtrusion: number[];
	/** Current heater temperatures, recorded per completed layer. */
	temperatures: number[];
}

export interface LayerHistory {
	/** Digest one poll's data; the full layers array when it changed, else null. */
	observe(obs: LayerObservation): Layer[] | null;
}

export function createLayerHistory(): LayerHistory {
	let layers: Layer[] = [];
	/** -1 = between prints; 0 = printing, no completed layer recorded yet. */
	let lastLayer = -1;
	let lastPrintDuration = 0;
	let lastFilePosition = 0;
	let lastZ = 0;
	let lastExtrusion: number[] = [];

	const observe = (obs: LayerObservation): Layer[] | null => {
		if (obs.duration === null) {
			// Not printing. Arm the reset; the NEXT print starts from nothing.
			lastLayer = -1;
			return null;
		}

		if (lastLayer === -1) {
			// A print began (or we connected mid-print): fresh history, and
			// baselines taken from this first sight — a mid-print connect makes
			// the elapsed time/extrusion spread over the backfilled layers below.
			layers = [];
			lastLayer = 0;
			lastPrintDuration = 0;
			lastFilePosition = 0;
			lastZ = obs.zPosition ?? 0;
			lastExtrusion = [];
			return [];
		}

		const layer = obs.layer;
		if (layer === null || layer <= 0 || layer === lastLayer) return null;

		// The layer number moved: spread what elapsed since the last change
		// over the layers it covered.
		const covered = layer > lastLayer ? layer - lastLayer : 1;
		const printDuration = obs.duration - (obs.warmUpDuration ?? 0);
		const avgDuration = (printDuration - lastPrintDuration) / covered;
		const avgFraction = obs.fileSize !== null && obs.fileSize > 0 && obs.filePosition !== null
			? (obs.filePosition - lastFilePosition) / (obs.fileSize * covered)
			: 0;
		const avgFilament = obs.rawExtrusion.map((total, i) => (total - (lastExtrusion[i] ?? 0)) / covered);
		const z = obs.zPosition ?? lastZ;
		const avgHeight = Math.abs(z - lastZ) / Math.abs(layer - lastLayer);

		let touched = false;
		if (layer > lastLayer) {
			// Completed layers are 1..layer-1; append the ones we now know about.
			// (The 0→N first transition of a print appends N-1 of them — that IS
			// the mid-print-connect backfill; for N=1 it appends nothing and
			// only advances the baselines.)
			while (layers.length < layer - 1) {
				layers.push({
					duration: avgDuration,
					filament: [...avgFilament],
					fractionPrinted: avgFraction,
					height: avgHeight,
					temperatures: [...obs.temperatures],
				});
				touched = true;
			}
		} else {
			// Sequential printing counts down: the elapsed stats belong to the
			// highest layer already recorded, not to a new entry.
			const target = layers[lastLayer - 1] ?? {
				duration: 0, filament: [], fractionPrinted: 0, height: avgHeight, temperatures: [...obs.temperatures],
			};
			if (layers[lastLayer - 1] === undefined) layers[lastLayer - 1] = target;
			target.duration += avgDuration;
			avgFilament.forEach((used, i) => {
				target.filament[i] = (target.filament[i] ?? 0) + used;
			});
			target.fractionPrinted += avgFraction;
			touched = true;
		}

		lastLayer = layer;
		lastPrintDuration = printDuration;
		lastFilePosition = obs.filePosition ?? lastFilePosition;
		lastZ = z;
		lastExtrusion = [...obs.rawExtrusion];
		if (!touched) return null;
		// A fresh copy each time: the emitted array is a value, not a window
		// into this module's mutable state.
		return layers.map(l => ({ ...l, filament: [...l.filament], temperatures: [...l.temperatures] }));
	};

	return { observe };
}
