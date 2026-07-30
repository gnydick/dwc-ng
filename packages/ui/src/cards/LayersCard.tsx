import { Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { LayerChart } from "../charts/LayerChart.tsx";
import { layerChartData, layerStats } from "../charts/layerData.ts";

/**
 * Per-layer print times: summary strip + uPlot bar chart. No layers exist
 * until a print has completed at least one — the compose registry's
 * visibleWhen (compose/defs.ts "layers") hides the card until then, using
 * the same layerStats this body renders from.
 *
 * Content-only body, extracted from views/Activity.tsx in the A4 conversion.
 */
export function LayersBody() {
	const app = useApp();
	const stats = createMemo(() => layerStats(app.om.om.job.layers));
	const chartData = createMemo(() => layerChartData(app.om.om.job.layers));

	return (
		<Show when={stats().count > 0} fallback={<p class="job-empty">No layer times</p>}>
			<div class="layer-summary">
				<span><b>{stats().count}</b> layers</span>
				<span>avg <b>{Math.round(stats().mean)}s</b></span>
				<span>min <b>{Math.round(stats().min)}s</b></span>
				<span>max <b>{Math.round(stats().max)}s</b></span>
			</div>
			<LayerChart data={chartData} />
		</Show>
	);
}
