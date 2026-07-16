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
	let el!: HTMLDivElement;
	let plot: uPlot | undefined;

	// Theme-matched axis/grid (uPlot needs concrete colors, not CSS vars).
	const AXIS = "#8fa3b8"; // --silk-dim
	const GRID = "rgba(143,163,184,0.10)";
	const height = () => props.height ?? 200;

	const build = (): void => {
		plot?.destroy();
		const opts: uPlot.Options = {
			width: el.clientWidth || 600,
			height: height(),
			cursor: { y: false },
			legend: { show: true },
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
		plot = new uPlot(opts, props.data(), el);
	};

	onMount(() => {
		build();
		const ro = new ResizeObserver(() => plot?.setSize({ width: el.clientWidth, height: height() }));
		ro.observe(el);
		onCleanup(() => {
			ro.disconnect();
			plot?.destroy();
		});
	});

	// Stream new samples into the existing plot.
	createEffect(() => {
		const d = props.data();
		if (plot) plot.setData(d);
	});

	// Rebuild only when the number of series changes (heaters added/removed).
	createEffect(on(() => props.series.length, (len, prev) => {
		if (prev !== undefined && len !== prev) build();
	}, { defer: true }));

	return <div class="temp-chart" ref={el} />;
}
