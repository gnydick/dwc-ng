import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { HeightMap } from "./parse.ts";
import { gridExtent } from "./surface.ts";
import type { Surface3D } from "./surface3d.ts";

/**
 * The rotatable 3D view of the height map.
 *
 * Babylon is imported LAZILY here, not at module scope: the bed page must not
 * pay for a 3D engine it may never show, and the 2D surface remains the default.
 *
 * Point PICKING deliberately stays with the 2D view. Selecting a cell to
 * re-probe is a precision act on a 16x16 grid, and ray-casting an orbiting mesh
 * is a worse way to do it — plus the 2D dots are real buttons, so they are
 * reachable by keyboard and screen reader. This view is for reading the bed's
 * SHAPE; the other is for acting on it.
 */
export function HeightMapSurface3D(props: {
	map: HeightMap;
	valueAt: (row: number, col: number) => number;
}) {
	let canvas!: HTMLCanvasElement;
	let host!: HTMLDivElement;
	const [surface, setSurface] = createSignal<Surface3D | null>(null);
	const [failed, setFailed] = createSignal("");
	// Mirrored into a signal because Surface3D.exaggeration() is a plain call:
	// read straight in the view it evaluated once, before the first setGrid had
	// computed it, and the note read "x 1" forever.
	const [exaggeration, setExaggeration] = createSignal(1);

	/** The grid including pending edits — the surface must show what you changed. */
	const currentRows = (): number[][] =>
		props.map.rows.map((row, r) => row.map((_, c) => props.valueAt(r, c)));

	// Build once, then feed it. A generation counter guards the await: switching
	// away mid-import must not leave an engine running against a dead canvas.
	let generation = 0;
	createEffect(() => {
		const gen = ++generation;
		void (async () => {
			try {
				const mod = await import("./surface3d.ts");
				if (gen !== generation) return;
				const created = mod.createSurface3D(canvas);
				setSurface(created);
			} catch (err) {
				setFailed(err instanceof Error ? err.message : String(err));
			}
		})();
	});

	// Feed the grid whenever it or the surface changes.
	createEffect(() => {
		const s = surface();
		if (s === null) return;
		const rows = currentRows();
		s.setGrid(rows, props.map.meta, gridExtent(rows));
		setExaggeration(s.exaggeration());
	});

	// Babylon sizes to the canvas's backing store, which does not follow CSS on
	// its own — the panel is resizable, so it must be told.
	createEffect(() => {
		const s = surface();
		if (s === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => s.resize());
		observer.observe(host);
		onCleanup(() => observer.disconnect());
	});

	onCleanup(() => {
		generation++;
		surface()?.dispose();
	});

	return (
		<div class="hm-3d" ref={host}>
			<canvas class="hm-3d-canvas" ref={canvas} />
			<Show when={failed() === ""} fallback={<p class="job-empty">3D view unavailable: {failed()}</p>}>
				{/* Exaggeration is not a detail: deviations are ~0.1mm on a ~330mm
				    bed, so a true-scale surface would be a flat plane. Stating the
				    factor stops a 30um ripple being read as a mountain range. */}
				<Show when={surface()}>
					<p class="hm-3d-note">vertical × {Math.round(exaggeration())}</p>
				</Show>
			</Show>
		</div>
	);
}
