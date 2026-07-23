import { Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { heaterSeries } from "../om/heaterSeries.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";

/**
 * Live heater temperatures. One chart series per heater, in heater order — the
 * chart aligns series to column index. Labels and colours come from
 * heaterSeries, which keeps the bed's gold out of the tool palette so no two
 * lines look alike.
 *
 * Content-only body; chrome comes from the compose registry
 * (compose/defs.ts "temperatures") or the legacy wrapper below.
 */
export function TemperaturesBody() {
	const app = useApp();
	const chartSeries = createMemo<ChartSeries[]>(() =>
		heaterSeries({
			heaters: app.om.om.heat.heaters,
			bedHeaters: app.om.om.heat.bedHeaters,
			chamberHeaters: app.om.om.heat.chamberHeaters,
			tools: app.om.om.tools,
		}),
	);

	return (
		<Show when={chartSeries().length} fallback={<p class="job-empty">Waiting for heaters…</p>}>
			<TemperatureChart data={app.temps.data} series={chartSeries()} height={220} />
		</Show>
	);
}
