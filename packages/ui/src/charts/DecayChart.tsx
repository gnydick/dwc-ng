/**
 * The ring-down of one capture: the raw accelerometer trace, the stop the
 * fitter located in it, the band-limited ring the fit was taken over, and the
 * fitted envelope laid on top of that ring.
 *
 * The envelope is `modeEnvelope()` of the very Mode the card prints beside the
 * plot (engine/fit.ts, `one-envelope-and-it-is-fitted`) — the fit, plotted, not
 * a second curve that agrees with it. There used to be two curves here, a
 * measured band-mask envelope and the exponential it implied; the measurement
 * was wrong near the stop and is gone (GIT_33).
 *
 * Same bridge to uPlot as TemperatureChart — build once, `setData` on change,
 * measure the HOST for height rather than uPlot's own root (which uPlot sizes
 * from the number we hand it, so reading it would be circular) — with two
 * differences that follow from what this chart is.
 *
 * The series shape never changes. There are always exactly three lines,
 * all-null where a capture has nothing to say for one, so this plot is built
 * once per mount and never rebuilt: switching capture or axis is a `setData`,
 * which cannot move anything on the page. That is not an optimisation, it is
 * the positional-stability requirement — a rebuild tears the canvas out and
 * puts a new one back, and everything below it moves while that happens.
 *
 * And the legend is not uPlot's. A hand-rolled key of three fixed rows lives
 * in the card beside the chart, so the plot's height is the host's height and
 * nothing under the chart depends on how many series happen to have data.
 *
 * Everything drawn on top of the lines — the stop marker and the analysed
 * window — comes from the same `DecayView` as the lines themselves
 * (charts/decayData.ts), read through a ref the draw hook closes over. uPlot
 * hooks are fixed at construction, so the hook reads the ref rather than the
 * prop: the prop is reactive, the hook is not, and a hook that captured the
 * first view would mark the first capture's stop on every later one.
 */
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { createEffect, onCleanup, onMount } from "solid-js";
import type { DecayView } from "./decayData.ts";
import { token, tokenAlpha } from "./themeColors.ts";

/**
 * The chart's floor in CSS pixels, matching `.shp-decay-plot`'s `min-height`
 * in app.css (30u at the default 4px unit). uPlot needs a number, and a number
 * smaller than the box it sits in leaves a white band under the canvas.
 */
const MIN_PLOT_H = 120;

export function DecayChart(props: { view: () => DecayView | null }) {
	let plotEl!: HTMLDivElement;
	let plot: uPlot | undefined;
	/** What the draw hook paints. Written before every setData; see the header. */
	let current: DecayView | null = null;

	const AXIS = token("--silk-dim", "#5a6b80");
	const GRID = tokenAlpha("--silk-dim", 0.1, "#5a6b80");
	const RAW = tokenAlpha("--silk-dim", 0.55, "#5a6b80");
	const ENVELOPE = token("--accent", "#a85c17");
	const RING = token("--gold", "#8a6a00");
	const STOP = token("--fault", "#b3271a");
	const BAND = tokenAlpha("--accent", 0.07, "#a85c17");

	const height = (): number => Math.max(MIN_PLOT_H, plotEl.clientHeight || MIN_PLOT_H);

	/** An empty plot still has axes, so an unselected card is the same shape as
	 *  a selected one — the whole reason this component renders at all times. */
	const EMPTY: uPlot.AlignedData = [[], [], [], []];

	/**
	 * The two marks, in the two hooks that put them where they belong.
	 *
	 * `drawClear` fires after the canvas is cleared and BEFORE the axes and
	 * series (uPlot.esm.js:4886), so the analysed band painted there sits
	 * under the trace; `draw` fires after everything, so the stop line drawn
	 * there sits on top of it. Painting both in one hook would either hide the
	 * marker under the raw trace or lay an opaque band over it.
	 *
	 * `valToPos(..., true)` returns CANVAS pixels — device ratio applied —
	 * which is the space `u.ctx` and `u.bbox` are both in. The clip keeps a
	 * mark whose time is outside the current x range off the axes.
	 */
	const clipped = (u: uPlot, paint: (ctx: CanvasRenderingContext2D) => void): void => {
		if (current === null) return;
		const ctx = u.ctx;
		ctx.save();
		ctx.beginPath();
		ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
		ctx.clip();
		paint(ctx);
		ctx.restore();
	};

	const paintBand = (u: uPlot): void => {
		clipped(u, ctx => {
			const band = current?.window ?? null;
			if (band === null) return;
			const x0 = u.valToPos(band.fromS, "x", true);
			const x1 = u.valToPos(band.toS, "x", true);
			ctx.fillStyle = BAND;
			ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
		});
	};

	const paintStop = (u: uPlot): void => {
		clipped(u, ctx => {
			const stopS = current?.stopS ?? null;
			if (stopS === null) return;
			const x = u.valToPos(stopS, "x", true);
			ctx.strokeStyle = STOP;
			ctx.lineWidth = Math.max(1, Math.round(uPlot.pxRatio));
			ctx.beginPath();
			ctx.moveTo(x, u.bbox.top);
			ctx.lineTo(x, u.bbox.top + u.bbox.height);
			ctx.stroke();
		});
	};

	const build = (): void => {
		const opts: uPlot.Options = {
			width: plotEl.clientWidth || 600,
			height: height(),
			// No legend: the card carries a fixed three-row key beside the plot,
			// so nothing under the chart resizes with the data.
			legend: { show: false },
			cursor: { y: false },
			hooks: { drawClear: [paintBand], draw: [paintStop] },
			scales: { x: { time: false } },
			axes: [
				{
					stroke: AXIS,
					grid: { stroke: GRID, width: 1 },
					ticks: { stroke: GRID },
					values: (_u, splits) => splits.map(v => `${v.toFixed(2)}s`),
				},
				{
					stroke: AXIS,
					grid: { stroke: GRID, width: 1 },
					ticks: { stroke: GRID },
					// Declared, not measured: the y axis gutter is part of the
					// plot's width, and a gutter that sized itself to the widest
					// tick would move the trace sideways as the data changed.
					size: 44,
					values: (_u, splits) => splits.map(v => v.toFixed(2)),
				},
			],
			series: [
				{},
				{ label: "raw", stroke: RAW, width: 1, points: { show: false } },
				{ label: "ring", stroke: RING, width: 1, points: { show: false } },
				{ label: "envelope", stroke: ENVELOPE, width: 2, points: { show: false } },
			],
		};
		plot = new uPlot(opts, EMPTY, plotEl);
	};

	onMount(() => {
		build();
		const ro = new ResizeObserver(() => plot?.setSize({ width: plotEl.clientWidth, height: height() }));
		ro.observe(plotEl);
		// The parent too: plotEl carries `contain: inline-size` (it has to, or
		// uPlot's pixel-sized canvas sets the card's minimum width), and a
		// size-contained element is not notified when its containing block
		// resizes it. Same finding as TemperatureChart.
		if (plotEl.parentElement) ro.observe(plotEl.parentElement);
		onCleanup(() => {
			ro.disconnect();
			plot?.destroy();
		});
	});

	// One `setData` per view. `current` is written FIRST so the redraw setData
	// triggers already has the marks for the data it is about to paint.
	createEffect(() => {
		const view = props.view();
		current = view;
		if (plot === undefined) return;
		plot.setData(view === null ? EMPTY : (view.data as unknown as uPlot.AlignedData));
		// The x window comes from the view, never from the data extent: the
		// ring-down is thirty times smaller than the acceleration pulses either
		// side of it, and uPlot fits y to whatever x is showing. `setScale`
		// after `setData` is the supported order — setData resets the scales,
		// then this pins x and y re-fits to what is inside it.
		if (view !== null) {
			plot.setScale("x", { min: view.xRange[0], max: view.xRange[1] });
			plot.setScale("y", { min: view.yRange[0], max: view.yRange[1] });
		}
	});

	return <div class="shp-decay-plot" ref={plotEl} />;
}
