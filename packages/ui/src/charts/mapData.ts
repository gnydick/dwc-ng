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

	return {
		viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
		box: {
			x: env.x[0],
			y: mapPoint(env, { x: env.x[0], y: env.y[1] }).y,
			w: env.x[1] - env.x[0],
			h: env.y[1] - env.y[0],
		},
		legs,
		stroke: span / 160,
		marker: span / 40,
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
