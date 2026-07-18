import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { createEffect, on, onCleanup, onMount } from "solid-js";
import type { AlignedData } from "../om/temperature.ts";

export interface ChartSeries {
	label: string;
	/** Line color (hex/rgb). */
	stroke: string;
}

/**
 * uPlot temperature chart. uPlot is imperative (canvas), so this bridges it to
 * Solid: build the plot once, push new samples via setData on each data change,
 * and rebuild only when the series *shape* changes (a heater appeared/left).
 * Colors/labels come from the caller (which knows tool/bed semantics).
 */
export function TemperatureChart(props: { data: () => AlignedData; series: ChartSeries[]; height?: number }) {
	let plotEl!: HTMLDivElement;
	let legendEl!: HTMLDivElement;
	let plot: uPlot | undefined;

	// Theme-matched axis/grid (uPlot needs concrete colors, not CSS vars).
	const AXIS = "#8fa3b8"; // --silk-dim
	const GRID = "rgba(143,163,184,0.10)";
	const height = () => props.height ?? 200;

	// uPlot's legend only shows a value at the hovered cursor position — blank
	// whenever the mouse isn't over the chart. Force it back to the newest
	// sample instead, so the legend always reads the current temperature at a
	// glance. setLegend doesn't re-fire the setCursor hook, so this can't loop.
	const showLatest = (p: uPlot): void => {
		const len = p.data[0]?.length ?? 0;
		if (len > 0) p.setLegend({ idx: len - 1 });
	};

	const build = (): void => {
		plot?.destroy();
		legendEl.replaceChildren();
		const opts: uPlot.Options = {
			width: plotEl.clientWidth || 600,
			height: height(),
			cursor: { y: false },
			// Default legend mounts as a row below the chart; move it into our
			// own left-hand column instead (uPlot's supported hook for this —
			// see legend.mount in uPlot.d.ts).
			legend: { show: true, mount: (_self, legendTable) => legendEl.appendChild(legendTable) },
			hooks: {
				setCursor: [u => {
					if (u.cursor.idx == null) showLatest(u);
				}],
			},
			scales: { x: { time: true } },
			axes: [
				{ stroke: AXIS, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID } },
				{
					stroke: AXIS,
					grid: { stroke: GRID, width: 1 },
					ticks: { stroke: GRID },
					size: 44,
					values: (_u, splits) => splits.map(v => `${v}°`),
				},
			],
			series: [
				{},
				...props.series.map(s => ({ label: s.label, stroke: s.stroke, width: 2, points: { show: false } })),
			],
		};
		plot = new uPlot(opts, props.data(), plotEl);
		showLatest(plot);
	};

	onMount(() => {
		build();
		const ro = new ResizeObserver(() => plot?.setSize({ width: plotEl.clientWidth, height: height() }));
		ro.observe(plotEl);
		onCleanup(() => {
			ro.disconnect();
			plot?.destroy();
		});
	});

	// Stream new samples into the existing plot. Only re-pin the legend to the
	// newest sample if the user isn't mid-hover (cursor.idx == null) — an
	// active hover keeps showing whatever point it's over.
	createEffect(() => {
		const d = props.data();
		if (plot) {
			plot.setData(d);
			if (plot.cursor.idx == null) showLatest(plot);
		}
	});

	// Rebuild only when the number of series changes (heaters added/removed).
	createEffect(on(() => props.series.length, (len, prev) => {
		if (prev !== undefined && len !== prev) build();
	}, { defer: true }));

	return (
		<div class="temp-chart">
			<div class="temp-chart-legend" ref={legendEl} />
			<div class="temp-chart-plot" ref={plotEl} />
		</div>
	);
}
