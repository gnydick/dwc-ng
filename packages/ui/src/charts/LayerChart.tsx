import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { createEffect, onCleanup, onMount } from "solid-js";
import type { AlignedData } from "../om/temperature.ts";
import { token, tokenAlpha } from "./themeColors.ts";
/**
 * Per-layer print-time chart. Bars, since layers are discrete: one bar per
 * completed layer, its height the seconds that layer took. Same imperative
 * uPlot bridge as TemperatureChart — build once, stream data via setData.
 *
 * x is the layer NUMBER, not time, so the x-scale is linear (not `time: true`).
 */
export function LayerChart(props: { data: () => AlignedData; height?: number }) {
	let plotEl!: HTMLDivElement;
	let plot: uPlot | undefined;

	// Read, not copied — see charts/themeColors.ts. The bar takes the accent
	// because layer times are the only series here: this chart has no palette of
	// its own to collide with, unlike the temperature chart's per-heater lines.
	const AXIS = token("--silk-dim", "#8a9099");
	const GRID = tokenAlpha("--silk-dim", 0.1, "#8a9099");
	const BAR = token("--accent-bright", "#5ce0ee");
	const BAR_FILL = tokenAlpha("--accent-bright", 0.35, "#5ce0ee");
	const height = (): number => props.height ?? 180;

	/** Compact seconds → "1m 20s" / "45s" for the y-axis ticks. */
	const fmt = (s: number): string => {
		const r = Math.round(s);
		return r >= 60 ? `${Math.floor(r / 60)}m${r % 60 ? ` ${r % 60}s` : ""}` : `${r}s`;
	};

	onMount(() => {
		const opts: uPlot.Options = {
			width: plotEl.clientWidth || 600,
			height: height(),
			cursor: { y: false },
			legend: { show: false },
			scales: { x: { time: false } },
			axes: [
				{
					stroke: AXIS,
					grid: { stroke: GRID, width: 1 },
					ticks: { stroke: GRID },
					// Layer numbers are integers — force whole-number ticks so uPlot
					// doesn't label 1.5, 2.5… between them.
					incrs: [1, 2, 5, 10, 20, 50, 100, 200, 500],
				},
				{
					stroke: AXIS,
					grid: { stroke: GRID, width: 1 },
					ticks: { stroke: GRID },
					size: 52,
					values: (_u, splits) => splits.map(fmt),
				},
			],
			series: [
				{ label: "Layer" },
				{
					label: "Time",
					stroke: BAR,
					fill: BAR_FILL,
					// Discrete layers read as bars, not a line.
					paths: uPlot.paths.bars!({ size: [0.7, 40] }),
					points: { show: false },
					value: (_u, v) => (v == null ? "" : fmt(v)),
				},
			],
		};
		plot = new uPlot(opts, props.data(), plotEl);
		const ro = new ResizeObserver(() => plot?.setSize({ width: plotEl.clientWidth, height: height() }));
		ro.observe(plotEl);
		onCleanup(() => {
			ro.disconnect();
			plot?.destroy();
		});
	});

	// Stream new layers into the existing plot as they complete.
	createEffect(() => {
		const d = props.data();
		plot?.setData(d);
	});

	return <div class="layer-chart" ref={plotEl} />;
}
