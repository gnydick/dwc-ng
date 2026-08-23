/**
 * The speed-sweep heatmap's layout and colour, derived from one `SweepMatrix`.
 *
 * WHAT THE CHART IS FOR, because it decides every choice below. A sweep runs
 * the same move at several speeds and takes an amplitude spectrum of each
 * cruise. Two very different things show up in that picture:
 *
 *   - a peak that sits at ONE frequency no matter how fast the axis moves is a
 *     structural mode ringing at its natural frequency — that is what input
 *     shaping cancels;
 *   - a peak whose frequency RISES WITH SPEED is forced excitation, motor
 *     ripple at `speed × fullStepsPerMm`, and shaping cannot touch it. Only
 *     current, microstepping or the mechanics move it.
 *
 * (Direction of the two is `engine/sweep.ts`'s, which is the physics: a
 * resonance does not know how fast the carriage is going, and a full-step rate
 * is proportional to it.)
 *
 * So the whole job of this layout is to make "vertical stripe" and "sloped
 * ridge" tell themselves apart at a glance, and the `fullStepHz` overlay is
 * drawn as the locus of "tracks speed": a ridge lying along it is forced, a
 * stripe crossing it is a mode.
 *
 * THREE CHOICES FOLLOW FROM THAT, and none of them is cosmetic.
 *
 * 1. LOG FREQUENCY AXIS (`HZ_FLOOR`..`matrix.maxHz`). The modes that matter on
 *    a real machine are low — Gabe's X/Y ring at 18.1 Hz and 51.7 Hz — and the
 *    forced content is high (his carriage mode is at 250 Hz, full-step reaches
 *    1 kHz). On a linear 0..700 Hz axis the two shapeable modes land inside the
 *    leftmost 7 % of the plot, three pixels apart on a card-width chart, and
 *    the chart fails at the one thing it exists for. On a log axis they sit at
 *    26 % and 47 % and the 250 Hz line at 79 %. A fixed peak is still a
 *    vertical stripe and a speed-proportional one is still a monotone rising
 *    ridge, so the reading survives the transform intact.
 *
 * 2. SPEED ROWS ARE CATEGORICAL BANDS, equal height, ascending upward. There is
 *    no data between two captures, so there is nothing to interpolate; a row is
 *    one capture and is labelled with its speed.
 *
 * 3. A dB AMPLITUDE MAPPING over `DYNAMIC_RANGE_DB`, not a linear one. Measured
 *    on the shipped fixtures (`test/fixtures/shaping/baseline_X_*.csv`, four
 *    speeds): the strongest row peaks at 1.556 g and the weakest at 0.051 g —
 *    a 29.7 dB spread between two peaks that both matter — while the per-row
 *    median bin sits 41–60 dB down. A linear ramp paints the weakest row's peak
 *    at 3 % of the scale, i.e. invisible, and the chart claims the slow rows
 *    are quiet when they are not.
 *
 * Pure and JSX-free by design (the plan's data/JSX split): node:test cannot
 * import a `.tsx`, and everything worth asserting here is a number or a colour.
 *
 * @invariant one-pixel-mapping-for-paint-and-hover
 * @rung 7  sole-constructor type — a `HeatLayout` is minted only by
 *          `heatmapCells`, and `cellAt` does not recompute a rectangle: it
 *          indexes the same `cells` array the painter draws and returns a cell
 *          only after checking the point against THAT cell's own rect. A
 *          tooltip therefore cannot name a cell other than the one drawn under
 *          the cursor, and a layout bug shows up as "no tooltip", never as
 *          "wrong number"
 * @why the tooltip is the only place the operator reads an exact frequency,
 *      and a tooltip that is one column out is worse than no tooltip — it
 *      would name 250 Hz over a 260 Hz stripe and send them shaping a mode
 *      that shaping cannot reach
 */
import type { SweepMatrix } from "../shaping/engine/sweep.ts";

/**
 * The lowest frequency the chart shows.
 *
 * A log axis cannot include 0, and the bins below this carry drift and the
 * move's own acceleration transient rather than a mode: RRF's own shaper
 * refuses frequencies under about 10 Hz, so nothing here is actionable. Set
 * below that rather than at it so a mode fitted near the limit is still on the
 * plot instead of pinned to its edge.
 */
export const HZ_FLOOR = 5;

/**
 * The window, in dB below the matrix maximum, that the colour ramp spans.
 *
 * Measured, not chosen: on the four shipped baseline fixtures the weakest row's
 * own peak is 29.7 dB below the strongest row's, so a window shorter than that
 * paints a real peak as empty ground. 40 dB puts that weakest peak at a quarter
 * of the ramp — pale but plainly a mark — while the per-row median bin (41 to
 * 60 dB down) maps to the ground and the plot does not fog over.
 */
export const DYNAMIC_RANGE_DB = 40;

/** The narrowest a cell may be, in CSS px. Below this a column is thinner than
 *  a pointer can be aimed at, and neighbouring peaks alias into each other. */
const MIN_CELL_W = 3;

/** How many quantised steps the ramp has. Enough that a gradient reads as one,
 *  few enough that the painter can batch by colour if it ever needs to. */
export const RAMP_STEPS = 32;

/**
 * The shipped values of the two tokens the ramp is built from.
 *
 * Both the `token()` fallback and the `parseColor()` fallback in the component
 * read these, so the "document has no stylesheet yet" path and the "ground
 * declared a colour we cannot parse" path cannot end up on two different
 * copper. They are not a second opinion about the palette: if either is ever
 * reached in a real browser, a token was misspelled.
 */
export const RAMP_FALLBACK = { ground: "#dee5ee", accent: "#a85c17" } as const;

// ---------------------------------------------------------------------------
// Colour: one hue, ground → accent, in OKLab
// ---------------------------------------------------------------------------

/** A colour in OKLCH: lightness 0..1, chroma, hue in degrees. */
export type Oklch = { readonly l: number; readonly c: number; readonly h: number };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const srgbToLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Linear-light sRGB → OKLab (Björn Ottosson's matrices). */
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

/** OKLab → linear-light sRGB. */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

/**
 * A CSS colour string as OKLCH, or `null` if this module cannot read it.
 *
 * Handles the two spellings a palette token can actually hold — `#rgb`/`#rrggbb`
 * and `rgb()`/`rgba()`. Anything else returns null rather than a guess, and the
 * caller falls back to `RAMP_FALLBACK`.
 */
export function parseColor(css: string): Oklch | null {
	const s = css.trim();
	let r: number, g: number, b: number;
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
	if (hex !== null) {
		const d = hex[1]!;
		const full = d.length === 3 ? d[0]! + d[0]! + d[1]! + d[1]! + d[2]! + d[2]! : d;
		const n = parseInt(full, 16);
		r = ((n >> 16) & 255) / 255;
		g = ((n >> 8) & 255) / 255;
		b = (n & 255) / 255;
	} else {
		const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
		if (fn === null) return null;
		r = Number(fn[1]) / 255;
		g = Number(fn[2]) / 255;
		b = Number(fn[3]) / 255;
	}
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
	const [L, A, B] = linearToOklab(srgbToLinear(clamp01(r)), srgbToLinear(clamp01(g)), srgbToLinear(clamp01(b)));
	const c = Math.hypot(A, B);
	const h = c < 1e-6 ? 0 : (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c, h: h < 0 ? h + 360 : h };
}

/** OKLCH → `#rrggbb`, clipped per channel into the sRGB cube. */
export function toHex(col: Oklch): string {
	const rad = (col.h * Math.PI) / 180;
	const [r, g, b] = oklabToLinear(col.l, col.c * Math.cos(rad), col.c * Math.sin(rad));
	const ch = (v: number): string =>
		Math.round(clamp01(linearToSrgb(clamp01(v))) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/** The relative luminance of an OKLCH colour, for a WCAG contrast ratio. */
export function luminance(col: Oklch): number {
	const rad = (col.h * Math.PI) / 180;
	const [r, g, b] = oklabToLinear(col.l, col.c * Math.cos(rad), col.c * Math.sin(rad));
	return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** WCAG contrast ratio between two OKLCH colours. */
export function contrast(a: Oklch, b: Oklch): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** How far past the accent's own lightness the ramp's top step is pushed, so
 *  the loudest cells separate from a merely loud one. */
const RAMP_OVERSHOOT = 0.1;

/** The lightness the ramp may not pass in either direction — beyond these the
 *  hue has no chroma left to carry and the top of the scale goes muddy. */
const RAMP_L_MIN = 0.2;
const RAMP_L_MAX = 0.92;

/** How fast the ground's own tint leaves the ramp. See `sweepRamp`. */
const GROUND_TINT_FADE = 3;

/**
 * The sequential ramp: ONE hue, monotone in lightness, anchored on the ground.
 *
 * The dataviz rule for a magnitude scale is a single hue running light→dark,
 * with the anchor flipped in dark mode. Both halves of that fall out of taking
 * the plot's own ground as step 0 and the accent's hue as the direction of
 * travel — on paper the accent is darker than the ground so the ramp darkens,
 * on graphite it is lighter so the ramp lightens, and neither case is written
 * down anywhere as a special case. That is the point: a third ground can be
 * added to theme-graphite.css and this ramp follows it with no edit here.
 *
 * Step 0 is the GROUND ITSELF, not a tint at the ground's lightness: the
 * interpolation runs in OKLab from the ground's own (a, b) to the accent's, so
 * a cell with nothing in it disappears into the well instead of laying a warm
 * cast over it.
 *
 * The ground's own tint is faded out CUBICALLY while the accent's comes in
 * linearly, which is what keeps this a one-hue ramp rather than a short slide
 * between two. A plain linear blend leaves the low steps 18° off the accent's
 * hue on graphite (whose ground is blue and whose accent is cyan); the cubic
 * fade holds every step carrying visible chroma — C >= 0.03 — inside 6° of it,
 * and below that chroma the colour is a neutral and has no hue to be wrong
 * about. Measured for both shipped grounds; the test pins it.
 *
 * @param ground the plot well's colour — the ramp's zero
 * @param accent the hue the ramp travels toward
 */
export function sweepRamp(ground: Oklch, accent: Oklch, steps: number = RAMP_STEPS): readonly string[] {
	const n = Math.max(2, Math.floor(steps));
	// Which way "more" points. A ground and an accent at the same lightness
	// gives no direction, so fall back to "away from the ground's own end".
	const raw = accent.l - ground.l;
	const dir = raw > 1e-3 ? 1 : raw < -1e-3 ? -1 : ground.l > 0.5 ? -1 : 1;
	const topL = Math.min(RAMP_L_MAX, Math.max(RAMP_L_MIN, accent.l + dir * RAMP_OVERSHOOT));
	const ab = (col: Oklch): [number, number] => {
		const rad = (col.h * Math.PI) / 180;
		return [col.c * Math.cos(rad), col.c * Math.sin(rad)];
	};
	const [a0, b0] = ab(ground);
	const [a1, b1] = ab({ l: topL, c: accent.c, h: accent.h });
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		const t = i / (n - 1);
		const fade = (1 - t) ** GROUND_TINT_FADE;
		const a = a0 * fade + a1 * t;
		const b = b0 * fade + b1 * t;
		const c = Math.hypot(a, b);
		const h = c < 1e-6 ? accent.h : (Math.atan2(b, a) * 180) / Math.PI;
		out.push(toHex({ l: ground.l + (topL - ground.l) * t, c, h }));
	}
	return out;
}

// ---------------------------------------------------------------------------
// Amplitude → ramp position
// ---------------------------------------------------------------------------

/**
 * An amplitude in g as a position on the ramp, 0..1.
 *
 * `DYNAMIC_RANGE_DB` below the matrix maximum is 0; the maximum is 1. A zero or
 * negative maximum (an empty matrix, or one whose rows all failed) gives 0
 * everywhere rather than a NaN, so the plot is an empty well and not a blank.
 */
export function ampToT(amp: number, maxAmp: number): number {
	if (!(maxAmp > 0) || !(amp > 0)) return 0;
	const db = 20 * Math.log10(amp / maxAmp);
	return clamp01(1 + db / DYNAMIC_RANGE_DB);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** One painted rectangle: a speed row × a slice of the frequency axis. */
export type HeatCell = {
	/** Index into `matrix.speeds`. */
	readonly speedIndex: number;
	/** The row's speed, mm/s. */
	readonly speed: number;
	/** The frequency slice this column covers, Hz, `[from, to]`. */
	readonly hzFrom: number;
	readonly hzTo: number;
	/** The bin that supplied `amp` — the loudest inside the slice. This is the
	 *  frequency the tooltip names, so it is a measured bin and never the
	 *  slice's midpoint. */
	readonly hz: number;
	/** Peak amplitude over the slice, g. Peak and not mean: a mode is one bin
	 *  wide and averaging is exactly how you lose it. */
	readonly amp: number;
	/** Position on the colour ramp, 0..1. */
	readonly t: number;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
};

/** Where the full-step excitation frequency falls on one speed row. */
export type FullStepPoint = {
	readonly speedIndex: number;
	readonly hz: number;
	readonly x: number;
	/** The row's vertical centre. */
	readonly y: number;
	/** False when the frequency is off the plot — over `maxHz` (a fast row's
	 *  full-step rate leaves the band) or under `HZ_FLOOR`. `x` is then clamped
	 *  to the edge so the line stays continuous, and the component can choose
	 *  not to cap it. */
	readonly inRange: boolean;
};

/**
 * The full-step overlay, split into what can be drawn as a line and what
 * cannot.
 *
 * A row whose full-step rate is off the plot has its `x` clamped to the frame,
 * and joining two clamped points draws a VERTICAL SEGMENT along the frame edge
 * — which is the one shape this chart must never draw by accident, because a
 * vertical line is how a fixed-frequency mode reads. Seen in the first render,
 * 2026-08-23, on a sweep whose top two speeds put full-step past 700 Hz.
 *
 * So `line` is the run of rows the locus is actually on the plot for, extended
 * by one clamped point at each end so it visibly LEAVES the frame, and every
 * other row is an `offScale` chevron on its own row instead.
 */
export type FullStepPath = {
	readonly line: readonly FullStepPoint[];
	readonly offScale: readonly { readonly speedIndex: number; readonly y: number; readonly side: "left" | "right" }[];
};

/** A labelled gridline on the log frequency axis. */
export type HzTick = { readonly hz: number; readonly x: number };

/** A labelled speed row. */
export type SpeedTick = { readonly speed: number; readonly y: number; readonly speedIndex: number };

export type HeatLayout = {
	readonly w: number;
	readonly h: number;
	readonly rows: number;
	readonly cols: number;
	readonly cellW: number;
	readonly cellH: number;
	/** The frequency band actually drawn, `[HZ_FLOOR, matrix.maxHz]`. */
	readonly hzRange: readonly [number, number];
	/** The loudest bin anywhere in the matrix, g — the top of the ramp. */
	readonly maxAmp: number;
	/** Row-major, `rows × cols`. Row 0 is the SLOWEST speed and sits at the
	 *  BOTTOM: speed increases upward, which is how the question "does this peak
	 *  move as I go faster" is read. */
	readonly cells: readonly HeatCell[];
	readonly fullStep: readonly FullStepPoint[];
	/** The same points, split into a drawable line and off-scale chevrons. */
	readonly fullStepPath: FullStepPath;
	readonly hzTicks: readonly HzTick[];
	readonly speedTicks: readonly SpeedTick[];
	/** Hz → x in CSS px. Clamped to the box, so a mode fitted outside the band
	 *  is drawn on the edge it left by rather than off-canvas. */
	readonly xOfHz: (hz: number) => number;
	/** Whether a frequency is inside the drawn band. */
	readonly inBand: (hz: number) => boolean;
	/**
	 * The cell under a point, in CSS px relative to the plot box, or null.
	 *
	 * Indexes `cells` and then checks the point against THAT cell's rectangle,
	 * so the cell returned always contains the point — see the invariant on
	 * this module.
	 */
	readonly cellAt: (px: number, py: number) => HeatCell | null;
};

const EMPTY_LAYOUT: HeatLayout = {
	w: 0,
	h: 0,
	rows: 0,
	cols: 0,
	cellW: 0,
	cellH: 0,
	hzRange: [HZ_FLOOR, HZ_FLOOR],
	maxAmp: 0,
	cells: [],
	fullStep: [],
	fullStepPath: { line: [], offScale: [] },
	hzTicks: [],
	speedTicks: [],
	xOfHz: () => 0,
	inBand: () => false,
	cellAt: () => null,
};

/** The decade-and-half-decade gridlines inside a band: 5, 10, 20, 50, 100, … */
function tickValues(lo: number, hi: number): number[] {
	const out: number[] = [];
	for (let decade = -1; decade <= 4; decade++) {
		for (const m of [1, 2, 5]) {
			const v = m * 10 ** decade;
			if (v >= lo && v <= hi) out.push(v);
		}
	}
	return out;
}

/**
 * A `SweepMatrix` as rectangles for a `w × h` CSS-pixel plot box.
 *
 * The box is the DATA AREA and nothing else: axis labels live in HTML gutters
 * outside it, so `x = 0` is exactly `HZ_FLOOR` and `x = w` is exactly
 * `matrix.maxHz`, and an HTML label positioned at `xOfHz(f) / w` of the box
 * lines up with the canvas by construction rather than by a shared constant.
 *
 * Columns are uniform in PIXELS and therefore logarithmic in FREQUENCY: column
 * `c` covers `[f0·r^c, f0·r^(c+1)]` with `r = (maxHz/f0)^(1/cols)`. Each takes
 * the LOUDEST bin inside it, or the nearest bin where the slice is narrower
 * than the 1 Hz bin spacing (true at the low end, where several columns share
 * one bin and the mode reads as a wide block — correct, since that is all the
 * resolution the transform has down there).
 *
 * Degenerate input — a non-finite or non-positive box, no speeds, no bins —
 * returns an empty layout. It never throws and never divides by zero: a chart
 * that throws during a resize takes the card down with it.
 */
export function heatmapCells(matrix: SweepMatrix | null, w: number, h: number): HeatLayout {
	if (matrix === null) return EMPTY_LAYOUT;
	const nBins = matrix.freqs.length;
	const nSpeeds = matrix.speeds.length;
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return EMPTY_LAYOUT;
	if (nSpeeds === 0 || nBins === 0) return EMPTY_LAYOUT;

	const hzLo = HZ_FLOOR;
	const hzHi = Math.max(HZ_FLOOR * 2, matrix.maxHz);
	const logLo = Math.log(hzLo);
	const logSpan = Math.log(hzHi) - logLo;

	const cols = Math.max(1, Math.min(nBins, Math.floor(w / MIN_CELL_W)));
	const rows = nSpeeds;
	const cellW = w / cols;
	const cellH = h / rows;

	const xOfHz = (hz: number): number => {
		if (!(hz > 0)) return 0;
		const p = (Math.log(hz) - logLo) / logSpan;
		return p <= 0 ? 0 : p >= 1 ? w : p * w;
	};
	const inBand = (hz: number): boolean => hz >= hzLo && hz <= hzHi;

	// The matrix maximum over the DRAWN band only. A bin under HZ_FLOOR is
	// drift, and letting drift set the top of the ramp would flatten every real
	// peak into the ground.
	let maxAmp = 0;
	const firstBin = Math.max(0, Math.ceil(hzLo));
	for (let r = 0; r < rows; r++) {
		const base = r * nBins;
		for (let k = firstBin; k < nBins; k++) {
			const v = matrix.amps[base + k]!;
			if (v > maxAmp) maxAmp = v;
		}
	}

	const cells: HeatCell[] = [];
	for (let r = 0; r < rows; r++) {
		const base = r * nBins;
		const speed = matrix.speeds[r]! as number;
		// Row 0 (slowest) at the bottom, edges again rather than origin + size.
		const y = (h * (rows - 1 - r)) / rows;
		const yTo = (h * (rows - r)) / rows;
		for (let c = 0; c < cols; c++) {
			const fFrom = Math.exp(logLo + (logSpan * c) / cols);
			const fTo = Math.exp(logLo + (logSpan * (c + 1)) / cols);
			let binLo = Math.ceil(fFrom);
			let binHi = Math.floor(fTo);
			if (binLo > binHi) {
				// Slice narrower than the bin spacing: the nearest bin is all the
				// resolution there is.
				const near = Math.round((fFrom + fTo) / 2);
				binLo = near;
				binHi = near;
			}
			binLo = Math.max(0, Math.min(nBins - 1, binLo));
			binHi = Math.max(0, Math.min(nBins - 1, binHi));
			let amp = 0;
			let hz = matrix.freqs[binLo]!;
			for (let k = binLo; k <= binHi; k++) {
				const v = matrix.amps[base + k]!;
				if (v > amp) {
					amp = v;
					hz = matrix.freqs[k]!;
				}
			}
			// Edges, not (origin + size): a cell's right edge is computed from the
			// SAME expression as its neighbour's left edge, so the tiling is exact
			// in floating point and `cellAt` cannot fall down a one-ulp crack
			// between two columns.
			const xFrom = (c * w) / cols;
			const xTo = ((c + 1) * w) / cols;
			cells.push({
				speedIndex: r,
				speed,
				hzFrom: fFrom,
				hzTo: fTo,
				hz,
				amp,
				t: ampToT(amp, maxAmp),
				x: xFrom,
				y,
				w: xTo - xFrom,
				h: yTo - y,
			});
		}
	}

	const fullStep: FullStepPoint[] = matrix.fullStepHz.map((f, r) => ({
		speedIndex: r,
		hz: f as number,
		x: xOfHz(f as number),
		y: h - (r + 0.5) * cellH,
		inRange: inBand(f as number),
	}));

	// The drawable run: from one before the first in-band row to one after the
	// last, so the locus is seen entering and leaving rather than stopping dead.
	const firstIn = fullStep.findIndex(p => p.inRange);
	let lastIn = -1;
	for (let i = fullStep.length - 1; i >= 0; i--) {
		if (fullStep[i]!.inRange) {
			lastIn = i;
			break;
		}
	}
	const from = firstIn < 0 ? 0 : Math.max(0, firstIn - 1);
	const to = lastIn < 0 ? -1 : Math.min(fullStep.length - 1, lastIn + 1);
	const line = firstIn < 0 ? [] : fullStep.slice(from, to + 1);
	const fullStepPath: FullStepPath = {
		line,
		offScale: fullStep
			.filter((_, i) => i < from || i > to)
			.map(p => ({ speedIndex: p.speedIndex, y: p.y, side: p.hz < hzLo ? ("left" as const) : ("right" as const) })),
	};

	const hzTicks: HzTick[] = tickValues(hzLo, hzHi).map(hz => ({ hz, x: xOfHz(hz) }));
	const speedTicks: SpeedTick[] = matrix.speeds.map((s, r) => ({
		speed: s as number,
		speedIndex: r,
		y: h - (r + 0.5) * cellH,
	}));

	const holds = (cell: HeatCell, px: number, py: number): boolean =>
		px >= cell.x && px < cell.x + cell.w && py >= cell.y && py < cell.y + cell.h;

	const cellAt = (px: number, py: number): HeatCell | null => {
		if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
		if (px < 0 || px >= w || py < 0 || py >= h) return null;
		const c0 = Math.floor(px / cellW);
		// Rows are stored slowest-first from the bottom, so a row counted from
		// the top is its mirror.
		const r0 = rows - 1 - Math.floor(py / cellH);
		// The division above can land one column out at an exact cell edge, so
		// the neighbours are probed too — but ONLY the containment test decides.
		// That is the invariant: whatever comes back is the rectangle the painter
		// drew under this point, and a miss is null rather than a guess.
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const r = r0 + dr;
				const c = c0 + dc;
				if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
				const cell = cells[r * cols + c]!;
				if (holds(cell, px, py)) return cell;
			}
		}
		return null;
	};

	return {
		w,
		h,
		rows,
		cols,
		cellW,
		cellH,
		hzRange: [hzLo, hzHi],
		maxAmp,
		cells,
		fullStep,
		fullStepPath,
		hzTicks,
		speedTicks,
		xOfHz,
		inBand,
		cellAt,
	};
}

/** A fitted mode marked on the frequency axis. */
export type SweepMarker = { readonly hz: number; readonly label: string };

/**
 * The fingerprint's per-axis modes as markers, skipping the axes that did not
 * fit. Takes the two modes rather than the `Fingerprint` so the sweep card can
 * mark a single-axis run without inventing an empty other half.
 */
export function fingerprintMarkers(modes: ReadonlyArray<{ axis: string; hz: number | null }>): SweepMarker[] {
	const out: SweepMarker[] = [];
	for (const m of modes) {
		if (m.hz === null || !Number.isFinite(m.hz) || m.hz <= 0) continue;
		out.push({ hz: m.hz, label: `${m.axis} ${m.hz.toFixed(1)} Hz` });
	}
	return out;
}

/** The tooltip's three facts, formatted once so the chart and any test agree. */
export function cellReadout(cell: HeatCell): { speed: string; hz: string; amp: string } {
	return {
		speed: `${Math.round(cell.speed)} mm/s`,
		hz: `${cell.hz.toFixed(cell.hz < 100 ? 1 : 0)} Hz`,
		amp: `${cell.amp.toFixed(cell.amp < 0.1 ? 4 : 3)} g`,
	};
}
