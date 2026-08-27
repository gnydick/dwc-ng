/**
 * The Capture card's XY map, as arithmetic.
 *
 * Pure and DOM-free, like `decayData.ts` and `sweepData.ts` beside it and for
 * the same reason: a drawing whose geometry is computed inside JSX is checkable
 * only by looking at it, and this particular drawing is a PROMISE — it is what
 * the operator reads before arming a run that crosses the bed at 200 mm/s. It
 * had better be a picture of the run that is about to happen.
 *
 * It takes segments it did not compute. `plannedSegments` (shaping/procedure.ts)
 * derives those from the same passes the procedure builds its commands from, so
 * this module's only job is projection: machine millimetres into SVG user units,
 * with Y the right way up.
 */

/** A point in the machine's own coordinates, as the object model reports one. */
export type MapPoint = { readonly x: number; readonly y: number };

/** The envelope, as config holds one. */
export type Box = { readonly x: readonly [number, number]; readonly y: readonly [number, number] };

/**
 * One machine point, projected — THE flip, and the only one.
 *
 * SVG's y grows downward and a printer's grows away from the operator, so a map
 * drawn straight through puts the front of the bed at the top: a mirror image
 * of the machine in front of them, on the one card whose job is to say where
 * the head is about to go.
 *
 * Exported because the carriage marker is projected SEPARATELY from the legs,
 * and that separation is deliberate. The plan changes when the operator edits a
 * setting; the carriage moves on every poll. Recomputing the whole polyline to
 * move a dot would hand Solid a fresh array of legs several times a second on a
 * card that is watched while the machine works. Two readers, one projection —
 * a second `y` arithmetic beside this one would eventually disagree, and the
 * symptom would be a dot that is not on the line it is travelling along.
 */
export function mapPoint(env: Box, p: MapPoint): MapPoint {
	return { x: p.x, y: env.y[0] + env.y[1] - p.y };
}

/** One drawn leg, already projected. */
export type MapLeg = {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
	/** The accelerometer is recording this one. */
	readonly measured: boolean;
	readonly label: string;
};

export type MapView = {
	/** `minX minY width height`, for the SVG's viewBox attribute. */
	readonly viewBox: string;
	/** The envelope, projected — a rectangle in the same user units. */
	readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
	readonly legs: readonly MapLeg[];
	/** Line width and marker radius in USER UNITS, so both scale with the
	 *  drawing rather than being pinned to screen pixels. A fixed screen width
	 *  would make the same map look different in a card the operator dragged
	 *  wider, which is the thing the global unit exists to prevent. */
	readonly stroke: number;
	readonly marker: number;
};

/** The input segments, in machine coordinates. Structurally what
 *  `plannedSegments` returns, without importing the shaping tree into a chart. */
export type MapSegment = {
	readonly from: MapPoint;
	readonly to: MapPoint;
	/** `capture` is the leg the accelerometer is armed for. Drawn alike they
	 *  would tell an operator the machine is about to record twice what it will. */
	readonly kind: "travel" | "capture";
	readonly label: string;
};

/** Fraction of the drawing's larger side left as margin, so a line running
 *  along the envelope's edge is not half-clipped by the viewBox. */
const MARGIN = 0.06;

/**
 * The stage the map is drawn into, in global units — THE single source.
 *
 * Two facts used to have no relationship: the stage was a fixed landscape box
 * declared in the stylesheet, and the viewBox was fitted to whatever aspect the
 * envelope happened to have. Nothing made them agree, and at a square envelope
 * they did not: MEASURED in headless Chromium at `--u: 4px`, a 400 x 400
 * envelope gave a stage of 232 x 184 px, an SVG box of 220 x 220 px and an
 * envelope rect whose bottom edge sat 30.21 px BELOW the stage's bottom. The
 * cause is the replaced-element rule, not the projection: an absolutely
 * positioned `<svg>` with `width: auto; height: auto` and all four insets takes
 * its width from the left/right insets and then derives its HEIGHT from the
 * intrinsic ratio the viewBox gives it, ignoring the top/bottom insets
 * entirely. A square viewBox therefore made a square SVG in a landscape stage.
 * Portrait was worse (-198.11 px), and landscape was never concentric either —
 * top 17.79 px against bottom 47.88 px; it merely did not clip, so nobody saw
 * it.
 *
 * So the relationship is now made rather than hoped for. This constant sizes
 * the stage element (via `MAP_STAGE_STYLE` — the stylesheet declares no width,
 * height or padding for it, so there is no second route) AND is the aspect
 * `mapView` fits its viewBox to. The aspect is not a parameter: no call site
 * can pass a different one, so a viewBox whose aspect disagrees with the box it
 * is drawn into is not expressible through this module.
 *
 * `w`/`h` are the OUTER box and `pad` the breathing room inside it; the SVG
 * viewport is the content box, which is what `VIEWPORT_ASPECT` describes.
 *
 * @invariant the-map-is-fitted-to-the-box-it-is-drawn-in
 * @rung 6  sole route — ONE constant is both the stage's size and the aspect
 *          the viewBox is fitted to. The stage gets its dimensions from
 *          `MAP_STAGE_STYLE` and from nowhere else (app.css declares no width,
 *          height or padding for `.shp-map-stage`, and a test asserts it does
 *          not), and the aspect `mapView` fits to is NOT a parameter, so no
 *          call site can supply a different one. A viewBox whose aspect
 *          disagrees with the viewport it is drawn into is therefore not
 *          expressible through this module's surface, and `xMidYMid meet`
 *          letterboxes by zero: the drawing maps ONTO the visible box, so it
 *          is fully visible and centred at every envelope aspect ratio
 * @why the drawing is a concentric pair — the envelope outside, the capture
 *      ring inside — and the operator reads the run's SHAPE off it before
 *      arming moves that cross the bed at 200 mm/s. Before the two facts were
 *      related, a 400 x 400 envelope produced a 220 x 220 SVG box in a
 *      220 x 172 opening and `overflow: hidden` took the envelope's bottom
 *      edge: measured -30.21 px of bottom margin against 17.79 px of top. A
 *      portrait envelope lost 198 px. Landscape was never concentric either
 *      (top 17.79, bottom 47.88) — it merely did not clip, which is why five
 *      months of landscape machines showed nothing
 * @debt a branded viewBox type minted only by `mapView`, so a hand-built
 *       `MapView` literal cannot carry an arbitrary aspect either; and a lint
 *       rather than a test for the stylesheet half
 */
export const MAP_STAGE = { w: 58, h: 46, pad: 1.5 } as const;

/**
 * The stage's dimensions as an inline style — the ONLY place a stage element
 * gets its size. Lengths are `calc(n * var(--u))` so they follow the global
 * unit exactly as a stylesheet rule would; what they must not do is live in a
 * second file, because then the number the viewBox is fitted to and the number
 * the browser lays out could differ and nothing would say so.
 */
export const MAP_STAGE_STYLE = {
	width: `calc(${MAP_STAGE.w} * var(--u))`,
	height: `calc(${MAP_STAGE.h} * var(--u))`,
	padding: `calc(${MAP_STAGE.pad} * var(--u))`,
} as const satisfies Readonly<Record<string, string>>;

/**
 * The SVG viewport's aspect ratio: the stage's CONTENT box, since `.shp-map`
 * fills that box (`width: 100%; height: 100%` on an in-flow block child of a
 * `border-box` stage). Greater than 1 by construction of the numbers above,
 * which is why the fit below only ever has to widen or heighten, never both.
 */
export const VIEWPORT_ASPECT =
	(MAP_STAGE.w - 2 * MAP_STAGE.pad) / (MAP_STAGE.h - 2 * MAP_STAGE.pad);

/**
 * Project a run onto the SVG's user-unit plane.
 *
 * Y IS FLIPPED. SVG's y grows downward and a printer's grows away from the
 * operator, so a map drawn straight through would put the front of the bed at
 * the top — a mirror image of the machine in front of them, on the one card
 * whose job is to say where the head is about to go. The flip is about the
 * ENVELOPE's own midline, so the box maps onto itself and its numbers still
 * read as the machine's.
 *
 * The view is fitted to the envelope AND to everything drawn on it, not to the
 * envelope alone. A plan that leaves the box is refused before it can run, but
 * the map is what the operator looks at to understand WHY — so it has to show
 * the line going outside rather than clipping it away at the edge.
 */
export function mapView(
	env: Box,
	segments: readonly MapSegment[],
): MapView {
	const legs: MapLeg[] = segments.map((s) => {
		const a = mapPoint(env, s.from);
		const b = mapPoint(env, s.to);
		return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, measured: s.kind === "capture", label: s.label };
	});

	const xs = [env.x[0], env.x[1], ...legs.flatMap((l) => [l.x1, l.x2])];
	const ys = [env.y[0], env.y[1], ...legs.flatMap((l) => [l.y1, l.y2])];

	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	// A degenerate box (a zero-width envelope cannot exist — `asRange` refuses
	// lo >= hi — but a caller could still hand this one point) must not produce
	// a zero-size viewBox, which renders as nothing at all.
	const span = Math.max(maxX - minX, maxY - minY, 1);
	const pad = span * MARGIN;

	// The fitted extent: everything drawn, plus the margin.
	const fitX = minX - pad;
	const fitY = minY - pad;
	const fitW = maxX - minX + pad * 2;
	const fitH = maxY - minY + pad * 2;

	// Then GROWN — never cropped — on whichever side is short of the viewport's
	// aspect, and grown symmetrically. Growing is what keeps every leg visible,
	// including the ones outside the envelope that say why a plan was refused;
	// symmetry is what keeps the drawing centred, so a plan inside the envelope
	// reads as the concentric pair it is. With the aspects then equal,
	// `preserveAspectRatio="xMidYMid meet"` letterboxes by zero: the viewBox
	// maps ONTO the viewport rather than into it.
	const w = fitW / fitH < VIEWPORT_ASPECT ? fitH * VIEWPORT_ASPECT : fitW;
	const h = fitW / fitH < VIEWPORT_ASPECT ? fitH : fitW / VIEWPORT_ASPECT;
	const x = fitX - (w - fitW) / 2;
	const y = fitY - (h - fitH) / 2;

	return {
		viewBox: `${x} ${y} ${w} ${h}`,
		box: {
			x: env.x[0],
			y: mapPoint(env, { x: env.x[0], y: env.y[1] }).y,
			w: env.x[1] - env.x[0],
			h: env.y[1] - env.y[0],
		},
		legs,
		// Off the FITTED viewBox width rather than the envelope's own span, so
		// the on-screen weight is the same at every aspect ratio: the viewBox
		// maps onto a viewport of fixed width, so `w / 160` user units is
		// always the same fraction of that width. Off the envelope's span it
		// would thin out on exactly the square and portrait envelopes the fit
		// above has to shrink.
		stroke: w / 160,
		marker: w / 40,
	};
}

/**
 * The map's one-line caption: how many measured legs, how far they travel, and
 * how much of the run is not being recorded.
 *
 * Counted from the SEGMENTS rather than from the settings that produced them,
 * so the sentence beside the drawing describes the drawing.
 */
export function mapSummary(segments: readonly MapSegment[]): string {
	const measured = segments.filter((s) => s.kind === "capture");
	if (measured.length === 0) return "no moves planned";
	const length = (s: MapSegment): number => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
	const measuredMm = measured.reduce((n, s) => n + length(s), 0);
	const travelMm = segments.filter((s) => s.kind === "travel").reduce((n, s) => n + length(s), 0);
	return `${measured.length} recorded ${measured.length === 1 ? "pass" : "passes"} · ${Math.round(measuredMm)} mm measured · ${Math.round(travelMm)} mm positioning`;
}
