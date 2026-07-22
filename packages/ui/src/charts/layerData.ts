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

/** Layers with a real duration — everything but a trailing in-progress layer. */
function completed(layers: Layer[]): Layer[] {
	if (layers.length > 0 && layers[layers.length - 1]!.duration === 0) {
		return layers.slice(0, -1);
	}
	return layers;
}

/** uPlot data: layer number (1-indexed) on x, layer duration (seconds) on y. */
export function layerChartData(layers: Layer[]): AlignedData {
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

export function layerStats(layers: Layer[]): LayerStats {
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
