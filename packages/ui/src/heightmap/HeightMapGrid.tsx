import { For, createEffect, onCleanup } from "solid-js";
import type { HeightMap } from "./parse.ts";
import { RAMP_STOPS, gridExtent, renderSurface } from "./surface.ts";

/**
 * The legend's gradient, built from the renderer's OWN stops.
 *
 * Derived rather than written out so adding or moving a stop updates the
 * legend automatically — a hand-maintained gradient would silently start
 * describing a surface it no longer matches. t runs -1..1, CSS wants 0..100%.
 */
const RAMP_GRADIENT = `linear-gradient(to right, ${RAMP_STOPS
	.map(s => `rgb(${s.color.r}, ${s.color.g}, ${s.color.b}) ${((s.t + 1) / 2) * 100}%`)
	.join(", ")})`;

/** Off-screen resolution of the interpolated field, scaled up by the browser. */
const SURFACE_PX = 96;

/**
 * The height map as a continuous gradient surface, with the actual probe points
 * marked as white dots on top of it.
 *
 * The surface is what you read the bed's shape from — which way it slopes, and
 * whether a bad reading is a real feature or one outlier in a smooth
 * neighbourhood. The dots are what you can act on: they mark where the machine
 * actually measured, and clicking one selects it for re-probing. Drawing only
 * discrete cells conflates the two.
 *
 * Rendered small (96px) and scaled up: the field is bilinear anyway, so the
 * browser's own smoothing does the enlargement for free rather than us
 * computing a million pixels on every poll.
 *
 * Orientation lives in renderSurface (row 0 at the bottom, since axis1 grows
 * away from the origin while screen y grows downward) and is tested there.
 */
export function HeightMapGrid(props: {
	map: HeightMap;
	valueAt: (row: number, col: number) => number;
	isEdited: (row: number, col: number) => boolean;
	selected: { row: number; col: number } | null;
	onSelect: (row: number, col: number) => void;
}) {
	let canvas!: HTMLCanvasElement;

	/** The grid including any pending edits — the surface must show what you changed. */
	const currentRows = (): number[][] =>
		props.map.rows.map((row, r) => row.map((_, c) => props.valueAt(r, c)));

	createEffect(() => {
		const rows = currentRows();
		const ctx = canvas.getContext("2d");
		if (ctx === null) return;
		canvas.width = SURFACE_PX;
		canvas.height = SURFACE_PX;
		const pixels = renderSurface(rows, SURFACE_PX, SURFACE_PX, gridExtent(rows));
		ctx.putImageData(new ImageData(pixels, SURFACE_PX, SURFACE_PX), 0, 0);
	});

	onCleanup(() => {
		// Free the backing store rather than leaving it to the GC when the view
		// is swapped out.
		canvas.width = 0;
		canvas.height = 0;
	});

	const { num0, num1, min0, max0, min1, max1 } = props.map.meta;

	/**
	 * Percentage position of a probe point over the surface. The surface spans
	 * exactly min..max on both axes, so a point sits at its fraction of that
	 * span — and row is flipped to match the rendering.
	 */
	const left = (col: number): string => `${num0 === 1 ? 50 : (col / (num0 - 1)) * 100}%`;
	const top = (row: number): string => `${num1 === 1 ? 50 : (1 - row / (num1 - 1)) * 100}%`;

	/** Largest absolute deviation the ramp is currently scaled to. */
	const extent = (): number => gridExtent(currentRows());

	return (
		<>
		<div
			class="hm-surface"
			// The BED's proportions, not the cell count: drawing a 330 x 290 bed
			// square would misrepresent the machine.
			style={{ "aspect-ratio": String((max0 - min0) / (max1 - min1 || 1)) }}
		>
			<canvas ref={canvas} class="hm-canvas" aria-hidden="true" />
			<For each={props.map.rows}>
				{(row, r) => (
					<For each={row}>
						{(_, c) => (
							<button
								class="hm-dot"
								classList={{
									edited: props.isEdited(r(), c()),
									selected: props.selected?.row === r() && props.selected?.col === c(),
								}}
								style={{ left: left(c()), top: top(r()) }}
								title={`row ${r()}, col ${c()}: ${props.valueAt(r(), c()).toFixed(3)} mm`}
								aria-label={`Probe point row ${r()} column ${c()}`}
								onClick={() => props.onSelect(r(), c())}
							/>
						)}
					</For>
				)}
			</For>
		</div>
		{/* The ramp is auto-scaled to the grid's own largest deviation, so the
		    same colour means a different number on a different map. Without the
		    numbers the surface says "there is a slope" but never "how much" —
		    which is most of what makes a colour field intuitive. Built from
		    terrainColor itself so it cannot drift from what is drawn. */}
		<div class="hm-legend" aria-hidden="true">
			<span class="hm-legend-end">−{extent().toFixed(3)}</span>
			<span class="hm-legend-bar" style={{ background: RAMP_GRADIENT }} />
			<span class="hm-legend-end">+{extent().toFixed(3)}</span>
		</div>
		</>
	);
}
