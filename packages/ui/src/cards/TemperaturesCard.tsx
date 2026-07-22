import { Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { heaterSeries } from "../om/heaterSeries.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/**
 * Live heater temperatures. One chart series per heater, in heater order — the
 * chart aligns series to column index. Labels and colours come from
 * heaterSeries, which keeps the bed's gold out of the tool palette so no two
 * lines look alike.
 *
 * Extracted from views/Machine.tsx (2026-07-22) to render in the Card Lab and
 * be reusable across views.
 */
export function TemperaturesCard(props: { canvas: PanelCanvasController }) {
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
		<Card id="temperatures" canvas={props.canvas} ariaLabel="Temperatures" title="Temperatures" tip="heat.heaters · live">
			<Show when={chartSeries().length} fallback={<p class="job-empty">Waiting for heaters…</p>}>
				<TemperatureChart data={app.temps.data} series={chartSeries()} height={220} />
			</Show>
		</Card>
	);
}
