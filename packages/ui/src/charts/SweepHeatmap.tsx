/**
 * The speed-sweep heatmap: speed × frequency × amplitude, hand-rolled canvas.
 *
 * A thin renderer over `charts/sweepData.ts`. Every number on screen — every
 * rectangle, the full-step polyline, the tick positions, the cell under the
 * pointer — comes out of one `heatmapCells()` call, so there is no arithmetic
 * in this file that could disagree with the arithmetic in that one. What is
 * left here is paint order, tokens and events.
 *
 * WHY CANVAS AND NOT uPLOT. uPlot is a line-chart library; a heatmap is a few
 * thousand filled rectangles with no series semantics, and the plan says
 * hand-rolled for exactly that reason. The one thing uPlot would have given us
 * — a device-pixel-correct canvas — is nine lines, and they are below.
 *
 * WHY THE TEXT IS HTML AND THE MARKS ARE CANVAS. The canvas box is the DATA
 * AREA and nothing else: `x = 0` is `HZ_FLOOR` and `x = w` is `maxHz`. Ticks,
 * axis titles, marker labels, the colour key and the tooltip live in HTML
 * gutters around it, positioned as a PERCENTAGE of the same box. That buys
 * three things at once — text that follows `--u` like every other length in
 * the app (canvas text would have to be sized in raw pixels), text that a
 * screen reader and a text search can reach, and alignment that holds by
 * construction because the HTML strip and the canvas are literally the same
 * width.
 *
 * POSITIONAL STABILITY. Nothing in this component can move anything on the
 * page:
 *
 *   - the host reserves its box with `--u` minimums and the canvas fills an
 *     absolutely-positioned wrapper at `width: 100%`, so the backing store's
 *     device-pixel size can never become a CSS size and reach the card's
 *     intrinsic width (the trap `.shp-decay-plot` has to spend
 *     `contain: inline-size` on; see the wrapper's own note);
 *   - hover paints NOTHING on the canvas. The highlight ring and the tooltip
 *     are absolutely-positioned HTML with `pointer-events: none`, so moving the
 *     pointer cannot trigger a repaint, a reflow, or a hover-loop;
 *   - the tick strips have a fixed height whether or not there are ticks, and
 *     the empty state is an overlay rather than a replacement.
 *
 * The paint effect reads `theme()` so switching ground repaints immediately —
 * `setTheme` flips an attribute rather than reloading, and a canvas, unlike
 * CSS, does not re-resolve a token on its own.
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { SweepMatrix } from "../shaping/engine/sweep.ts";
import { theme } from "../shell/theme.ts";
import { token, tokenAlpha } from "./themeColors.ts";
import {
	cellReadout, DYNAMIC_RANGE_DB, heatmapCells, parseColor, RAMP_FALLBACK, RAMP_STEPS, sweepRamp,
	type HeatCell, type HeatLayout, type SweepMarker,
} from "./sweepData.ts";

/** The gutters around the data area. Text lives in these; the canvas does not. */
const GUTTER_L = "calc(11 * var(--u))";
const GUTTER_R = "calc(3 * var(--u))";
/** Top: one row of fitted-mode labels. */
const GUTTER_T = "calc(5 * var(--u))";
/** Bottom: a row of Hz ticks, then a row carrying the axis title and the key. */
const TICK_ROW = "calc(5 * var(--u))";
const KEY_ROW = "calc(5.5 * var(--u))";
const GUTTER_B = `calc(10.5 * var(--u))`;

const LABEL_SIZE = "calc(3 * var(--u))";
const TITLE_SIZE = "calc(2.75 * var(--u))";

/** Device-pixel line weights, multiplied by the ratio at paint time. */
const HAIRLINE_W = 1;
const OVERLAY_W = 1.5;
const HALO_W = 4;
const DASH_ON = 6;
const DASH_OFF = 4;
const KNOT_R = 2.5;
const MARKER_TIP = 5;
/** Half-height of the "the full-step rate is off this end of the plot" chevron. */
const CHEVRON = 4;

export type SweepHeatmapProps = {
	/** The matrix to draw, or null before a sweep has run. */
	matrix: () => SweepMatrix | null;
	/** Fitted modes to mark on the frequency axis. */
	markers?: () => readonly SweepMarker[];
};

/** The pair of colours the ramp is built from, resolved from the live tokens. */
function rampColours(): readonly string[] {
	const ground = parseColor(token("--mask-900", RAMP_FALLBACK.ground)) ?? parseColor(RAMP_FALLBACK.ground)!;
	const accent = parseColor(token("--accent", RAMP_FALLBACK.accent)) ?? parseColor(RAMP_FALLBACK.accent)!;
	return sweepRamp(ground, accent, RAMP_STEPS);
}

/** `t` in 0..1 as a step of a quantised ramp. */
const stepOf = (t: number, steps: number): number => {
	const i = Math.round(t * (steps - 1));
	return i < 0 ? 0 : i > steps - 1 ? steps - 1 : i;
};

/** A percentage string for an HTML overlay positioned against the data area. */
const pct = (v: number, of: number): string => `${of > 0 ? (v / of) * 100 : 0}%`;

export function SweepHeatmap(props: SweepHeatmapProps) {
	let canvasEl!: HTMLCanvasElement;
	const [box, setBox] = createSignal<{ w: number; h: number }>({ w: 0, h: 0 });
	const [hover, setHover] = createSignal<HeatCell | null>(null);

	const layout = createMemo<HeatLayout>(() => {
		const b = box();
		return heatmapCells(props.matrix(), b.w, b.h);
	});

	/** The ramp, re-resolved when the ground changes — `setTheme` flips an
	 *  attribute rather than reloading, and canvas colours are strings. */
	const ramp = createMemo<readonly string[]>(() => {
		theme();
		return rampColours();
	});

	const markers = createMemo<readonly SweepMarker[]>(() => {
		const l = layout();
		const src = props.markers?.() ?? [];
		return src.filter(m => l.inBand(m.hz));
	});

	/**
	 * The whole picture, repainted from scratch.
	 *
	 * Called for a new matrix, a resize and a theme change and for nothing else
	 * — hover is HTML. A full repaint of a few thousand rectangles is well under
	 * a frame, and it means there is exactly one code path that produces the
	 * canvas, so no partial-update path can leave a stale mark on it.
	 */
	const paint = (): void => {
		const l = layout();
		const ctx = canvasEl.getContext("2d");
		if (ctx === null) return;
		const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
		const dw = Math.max(1, Math.round(l.w * dpr));
		const dh = Math.max(1, Math.round(l.h * dpr));
		if (canvasEl.width !== dw) canvasEl.width = dw;
		if (canvasEl.height !== dh) canvasEl.height = dh;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, dw, dh);

		const colours = ramp();
		// The well IS step 0 of the ramp, so a silent cell is indistinguishable
		// from the ground rather than merely close to it.
		ctx.fillStyle = colours[0]!;
		ctx.fillRect(0, 0, dw, dh);
		if (l.cols === 0 || l.rows === 0) return;

		// Cells. Rects are snapped to device pixels by rounding both edges, so
		// adjacent cells share an edge exactly — no seams of ground showing
		// through a solid band, and no double-painted overlaps.
		for (const cell of l.cells) {
			const step = stepOf(cell.t, colours.length);
			if (step === 0) continue; // already the ground
			const x0 = Math.round(cell.x * dpr);
			const x1 = Math.round((cell.x + cell.w) * dpr);
			const y0 = Math.round(cell.y * dpr);
			const y1 = Math.round((cell.y + cell.h) * dpr);
			ctx.fillStyle = colours[step]!;
			ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
		}

		// One hairline between speed rows: a row is a separate capture, and
		// saying so costs a pixel that carries no frequency information.
		ctx.fillStyle = token("--hairline", "rgba(22, 32, 46, 0.16)");
		for (let r = 1; r < l.rows; r++) {
			ctx.fillRect(0, Math.round(r * l.cellH * dpr), dw, Math.max(1, Math.round(HAIRLINE_W * dpr)));
		}

		// The full-step locus: where a peak WOULD sit if it were forced by motor
		// ripple rather than ringing. Drawn as annotation, in the text colour and
		// dashed, so it never reads as a series of its own.
		const ink = tokenAlpha("--silk", 0.65, "#16202e");
		const path = l.fullStepPath;
		if (path.line.length > 1) {
			const trace = (): void => {
				ctx.beginPath();
				path.line.forEach((p, i) => {
					const x = p.x * dpr;
					const y = p.y * dpr;
					if (i === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				});
			};
			// A halo in the ground colour first, so the dashes stay readable
			// wherever the line crosses a saturated cell.
			ctx.lineCap = "round";
			ctx.setLineDash([]);
			ctx.strokeStyle = colours[0]!;
			ctx.lineWidth = HALO_W * dpr;
			trace();
			ctx.stroke();
			ctx.setLineDash([DASH_ON * dpr, DASH_OFF * dpr]);
			ctx.strokeStyle = ink;
			ctx.lineWidth = OVERLAY_W * dpr;
			trace();
			ctx.stroke();
			ctx.setLineDash([]);
		}
		for (const p of path.line) {
			if (!p.inRange) continue;
			ctx.beginPath();
			ctx.arc(p.x * dpr, p.y * dpr, KNOT_R * dpr, 0, Math.PI * 2);
			ctx.fillStyle = ink;
			ctx.fill();
		}
		// Rows whose full-step rate is off the plot get a chevron on the edge it
		// left by — never a segment along the frame, which would read as a
		// fixed-frequency stripe.
		for (const off of path.offScale) {
			const dir = off.side === "right" ? -1 : 1;
			const edge = off.side === "right" ? dw : 0;
			const y = off.y * dpr;
			const t = CHEVRON * dpr;
			ctx.strokeStyle = ink;
			ctx.lineWidth = OVERLAY_W * dpr;
			ctx.beginPath();
			ctx.moveTo(edge + dir * t * 1.6, y - t);
			ctx.lineTo(edge + dir * t * 0.4, y);
			ctx.lineTo(edge + dir * t * 1.6, y + t);
			ctx.stroke();
		}

		// Fitted modes. A different hue from both the ramp and the annotation
		// ink, because this is a second MEASUREMENT (the decay fit) laid over the
		// first, not a label about it.
		const modeInk = token("--magenta", "#9b3d76");
		for (const m of markers()) {
			const x = Math.round(l.xOfHz(m.hz) * dpr);
			ctx.strokeStyle = colours[0]!;
			ctx.lineWidth = HALO_W * dpr;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, dh);
			ctx.stroke();
			ctx.strokeStyle = modeInk;
			ctx.lineWidth = OVERLAY_W * dpr;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, dh);
			ctx.stroke();
			// A tip at the top, so the line is findable where it runs over dark
			// cells and so the HTML label above it has something to point at.
			const tip = MARKER_TIP * dpr;
			ctx.fillStyle = modeInk;
			ctx.beginPath();
			ctx.moveTo(x - tip, 0);
			ctx.lineTo(x + tip, 0);
			ctx.lineTo(x, tip * 1.4);
			ctx.closePath();
			ctx.fill();
		}
	};

	onMount(() => {
		const ro = new ResizeObserver(() => {
			const r = canvasEl.getBoundingClientRect();
			const next = { w: r.width, h: r.height };
			const now = box();
			if (next.w !== now.w || next.h !== now.h) setBox(next);
		});
		// The canvas fills an absolutely-positioned wrapper, so its size is
		// imposed on it from the host's insets and observing it cannot feed back
		// into the layout. Observing the host instead would be wrong: the host's
		// box includes the gutters, and the plot is the canvas.
		ro.observe(canvasEl);
		const r = canvasEl.getBoundingClientRect();
		setBox({ w: r.width, h: r.height });
		onCleanup(() => ro.disconnect());
	});

	createEffect(() => {
		// Tracked: the layout (matrix + box) and the ground. Everything the
		// canvas can show is a function of those three.
		layout();
		markers();
		theme();
		paint();
	});

	const onMove = (e: PointerEvent): void => {
		const l = layout();
		const r = canvasEl.getBoundingClientRect();
		setHover(l.cellAt(e.clientX - r.left, e.clientY - r.top));
	};

	const maxLabel = createMemo(() => {
		const m = layout().maxAmp;
		return m > 0 ? `${m.toFixed(m < 0.1 ? 4 : 3)} g` : "—";
	});

	const key = createMemo(() => ramp().join(", "));

	return (
		<div
			style={{
				position: "relative",
				flex: "1",
				"min-width": "calc(56 * var(--u))",
				"min-height": "calc(36 * var(--u))",
			}}
		>
			{/* Speed axis: one label per capture, at the row's centre. */}
			<div
				style={{
					position: "absolute", left: "0", width: GUTTER_L, top: GUTTER_T, bottom: GUTTER_B,
					"font-size": LABEL_SIZE, color: "var(--silk-dim)", "font-variant-numeric": "tabular-nums",
				}}
			>
				<For each={layout().speedTicks}>
					{tick => (
						<span
							style={{
								position: "absolute", right: "calc(1.5 * var(--u))",
								top: pct(tick.y, layout().h), transform: "translateY(-50%)", "white-space": "nowrap",
							}}
						>
							{Math.round(tick.speed)}
						</span>
					)}
				</For>
			</div>
			{/* The speed axis's title sits in the top-left corner cell, clear of the
			    topmost row label — inside the tick column it collided with it. */}
			<div
				style={{
					position: "absolute", left: "0", top: "0", width: GUTTER_L, height: GUTTER_T,
					display: "flex", "align-items": "center", "justify-content": "flex-end",
					"padding-right": "calc(1.5 * var(--u))", "font-size": TITLE_SIZE, color: "var(--silk-dim)",
					"letter-spacing": "0.08em", "text-transform": "uppercase",
				}}
			>
				mm/s
			</div>

			{/* Fitted-mode labels, above the lines they belong to. */}
			<div style={{ position: "absolute", left: GUTTER_L, right: GUTTER_R, top: "0", height: GUTTER_T }}>
				<For each={markers()}>
					{m => (
						<span
							style={{
								position: "absolute", bottom: "calc(0.5 * var(--u))",
								left: pct(layout().xOfHz(m.hz), layout().w),
								transform: "translateX(-50%)", "white-space": "nowrap",
								"font-size": TITLE_SIZE, color: "var(--magenta)", "font-variant-numeric": "tabular-nums",
							}}
						>
							{m.label}
						</span>
					)}
				</For>
			</div>

			{/* The canvas is WRAPPED rather than inset directly. A canvas is a
			    replaced element: its `width`/`height` attributes are an intrinsic
			    size, and an absolutely-positioned replaced element with
			    `width: auto` takes that intrinsic size instead of the one its
			    insets describe — so the backing store's device-pixel width became
			    a CSS width, the canvas grew past the card, the next measurement
			    read the bigger box, and it grew again. Seen on the first browser
			    render, 2026-08-23. Inside a plain block wrapper, `width: 100%` is
			    definite and the intrinsic size never gets a vote. */}
			<div style={{ position: "absolute", left: GUTTER_L, right: GUTTER_R, top: GUTTER_T, bottom: GUTTER_B }}>
				<canvas
					ref={canvasEl}
					style={{
						display: "block", width: "100%", height: "100%", "border-radius": "var(--radius)",
						"box-shadow": "inset 0 0 0 1px var(--hairline)",
					}}
					onPointerMove={onMove}
					onPointerLeave={() => setHover(null)}
				/>
			</div>

			{/* The hovered cell, ringed in HTML so hovering never repaints. */}
			<Show when={hover()}>
				{cell => (
					<div
						style={{
							position: "absolute", left: GUTTER_L, right: GUTTER_R, top: GUTTER_T, bottom: GUTTER_B,
							"pointer-events": "none",
						}}
					>
						<div
							style={{
								position: "absolute",
								left: pct(cell().x, layout().w),
								top: pct(cell().y, layout().h),
								width: pct(cell().w, layout().w),
								height: pct(cell().h, layout().h),
								"box-shadow": "inset 0 0 0 1px var(--silk), 0 0 0 1px var(--mask-900)",
							}}
						/>
					</div>
				)}
			</Show>

			{/* Frequency ticks. The strip is the same width as the canvas, so a
			    percentage here and a pixel there are the same place. */}
			<div
				style={{
					position: "absolute", left: GUTTER_L, right: GUTTER_R, bottom: KEY_ROW, height: TICK_ROW,
					"font-size": LABEL_SIZE, color: "var(--silk-dim)", "font-variant-numeric": "tabular-nums",
				}}
			>
				<For each={layout().hzTicks}>
					{tick => (
						<span
							style={{
								position: "absolute", top: "calc(0.75 * var(--u))",
								left: pct(tick.x, layout().w), transform: "translateX(-50%)", "white-space": "nowrap",
							}}
						>
							{tick.hz}
						</span>
					)}
				</For>
			</div>

			{/* Axis title and colour key. Both are text as well as colour: the
			    scale is never readable from the swatch alone. */}
			<div
				style={{
					position: "absolute", left: GUTTER_L, right: GUTTER_R, bottom: "0", height: KEY_ROW,
					display: "flex", "align-items": "center", gap: "calc(2 * var(--u))",
					"font-size": TITLE_SIZE, color: "var(--silk-dim)",
					"letter-spacing": "0.08em", "text-transform": "uppercase",
				}}
			>
				<span>Hz (log)</span>
				<span style={{ flex: "1" }} />
				<span style={{ "text-transform": "none", "letter-spacing": "0" }}>{DYNAMIC_RANGE_DB} dB</span>
				<span
					style={{
						width: "calc(20 * var(--u))", height: "calc(2 * var(--u))",
						"background-image": `linear-gradient(to right, ${key()})`,
						"box-shadow": "inset 0 0 0 1px var(--hairline)", "border-radius": "var(--radius)",
					}}
				/>
				<span style={{ "text-transform": "none", "letter-spacing": "0", "font-variant-numeric": "tabular-nums" }}>
					{maxLabel()}
				</span>
			</div>

			{/* The tooltip. An HTML layer over the canvas — never drawn into it —
			    so it can carry real text at the app's own scale and can never
			    survive into the next paint. */}
			<Show when={hover()}>
				{cell => {
					const facts = createMemo(() => cellReadout(cell()));
					return (
					<div
						style={{
							position: "absolute", left: GUTTER_L, right: GUTTER_R, top: GUTTER_T, bottom: GUTTER_B,
							"pointer-events": "none",
						}}
					>
						<div
							style={{
								position: "absolute",
								left: `clamp(0%, ${pct(cell().x + cell().w / 2, layout().w)}, 100%)`,
								top: pct(cell().y, layout().h),
								transform: "translate(-50%, calc(-100% - 1 * var(--u)))",
								padding: "calc(1 * var(--u)) calc(1.75 * var(--u))",
								background: "var(--mask-700)", color: "var(--silk)",
								"box-shadow": "inset 0 0 0 1px var(--hairline), 0 2px 8px rgba(0,0,0,0.28)",
								"border-radius": "var(--radius)", "white-space": "nowrap",
								"font-size": LABEL_SIZE, "font-variant-numeric": "tabular-nums",
								display: "flex", gap: "calc(1.5 * var(--u))",
							}}
						>
							<span>{facts().speed}</span>
							<span style={{ color: "var(--accent)" }}>{facts().hz}</span>
							<span>{facts().amp}</span>
						</div>
					</div>
					);
				}}
			</Show>

			{/* Empty state as an OVERLAY, so an unrun sweep is the same shape as a
			    finished one and nothing moves when the first matrix arrives. */}
			<Show when={props.matrix() === null}>
				<p
					style={{
						position: "absolute", inset: "0", margin: "0", display: "grid", "place-items": "center",
						color: "var(--silk-dim)", "font-size": "calc(3.5 * var(--u))", "pointer-events": "none",
					}}
				>
					No sweep yet
				</p>
			</Show>
		</div>
	);
}
