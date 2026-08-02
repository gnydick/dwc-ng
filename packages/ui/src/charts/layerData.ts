/**
 * Per-layer print-time data for the layer chart, derived from job.layers.
 *
 * RRF appends the current layer to `job.layers` with duration 0 and fills the
 * duration in once the layer completes. Charting that trailing zero draws a
 * misleading full-width zero bar beside the real layers, so it is dropped — but
 * only the LAST entry, since only the last one is the in-progress layer.
 */
import type { Layer } from "../om/types.ts";
import type { AlignedData } from "../om/temperature.ts";

/** Layers with a real duration — everything but a trailing in-progress layer.
 *  Total over undefined: a wholesale job-subtree replacement from a board
 *  that doesn't report `layers` deletes the key entirely (the OM rule is
 *  "tolerate missing fields") — that must read as "no layers", not a crash.
 *  Found live 2026-07-23: the layers card's visibleWhen threw on it.
 *
 * @invariant the-in-progress-layer-is-never-a-statistic
 * @rung 6  choke-point — one `completed()`, private to this module, and both
 *          exports (layerChartData and layerStats) start by calling it. There
 *          is no path from job.layers to a rendered figure that does not pass
 *          through here, and the module's only consumer is LayersCard
 * @why RRF appends the CURRENT layer with duration 0 and fills it in once the
 *      layer finishes. Counted, that zero drags the mean down and pins the
 *      minimum at 0 for the whole print — every "fastest layer" reading would
 *      be wrong, always, and the chart would draw a full-width zero bar beside
 *      the real ones. Only the LAST entry is in progress, so trimming more
 *      would discard real data
 * @debt the trailing zero is recognised by its VALUE, so a genuinely
 *       instantaneous layer (a board reporting whole seconds, a layer under
 *       500ms) is indistinguishable from an in-progress one and gets dropped.
 *       Promote by taking the live layer number alongside the array and
 *       trimming by INDEX, which is the fact actually being reasoned about.
 */
function completed(layers: Layer[] | undefined): Layer[] {
	if (layers === undefined) return [];
	if (layers.length > 0 && layers[layers.length - 1]!.duration === 0) {
		return layers.slice(0, -1);
	}
	return layers;
}

/** uPlot data: layer number (1-indexed) on x, layer duration (seconds) on y. */
export function layerChartData(layers: Layer[] | undefined): AlignedData {
	const done = completed(layers);
	const x = done.map((_, i) => i + 1);
	const y = done.map(l => l.duration);
	return [x, y];
}

export interface LayerStats {
	count: number;
	/** Fastest / slowest completed layer, seconds. */
	min: number;
	max: number;
	mean: number;
	/** Sum of completed-layer durations, seconds. */
	total: number;
}

export function layerStats(layers: Layer[] | undefined): LayerStats {
	const done = completed(layers);
	if (done.length === 0) return { count: 0, min: 0, max: 0, mean: 0, total: 0 };
	let min = Infinity;
	let max = -Infinity;
	let total = 0;
	for (const l of done) {
		if (l.duration < min) min = l.duration;
		if (l.duration > max) max = l.duration;
		total += l.duration;
	}
	return { count: done.length, min, max, mean: total / done.length, total };
}
