/**
 * The height map as a rotatable 3D surface.
 *
 * Lazily imported (see HeightMapSurface3D.tsx) so the bed page does not pull
 * Babylon in until you actually switch to this view.
 *
 * ── Vertical exaggeration is unavoidable, so it is REPORTED. ─────────────────
 * Deviations here are ~0.1mm across a ~330mm bed — a ratio of about 1:3000.
 * Drawn to true scale the surface would be a perfectly flat plane and the view
 * would be useless. So the vertical axis is scaled until the largest deviation
 * is a readable fraction of the bed, and the factor is handed back for the UI
 * to display. A 3D surface that silently exaggerates by 1000x invites reading
 * a 30um ripple as a mountain range.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Colours come from terrainColor, the same function the 2D canvas and the
 * legend use, so all three describe the same data identically.
 */
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import "@babylonjs/core/Meshes/Builders/sphereBuilder.js"; // registers MeshBuilder.CreateSphere (probe-point markers)
import "@babylonjs/core/Meshes/thinInstanceMesh.js"; // one draw call for all 256 markers
// REQUIRED for picking. Deep-importing Babylon leaves Scene.pick inert until
// the ray module is pulled in — it is what installs createPickingRay. Without
// it every pick silently misses, which looks exactly like "the meshes are not
// clickable" rather than like a missing import.
import "@babylonjs/core/Culling/ray.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import { sampleGridCubic, terrainColor } from "./surface.ts";
import type { HeightMapMeta } from "./parse.ts";

/** A bed out by REFERENCE_DEVIATION is drawn with this much relief, as a
 *  fraction of its longer side. */
const RELIEF_FRACTION = 0.12;

/**
 * The deviation that counts as "properly out" — the yardstick the vertical
 * scale is pinned to.
 *
 * The scale is deliberately ABSOLUTE, not normalised to each map's own extent.
 * Normalising made every bed fill the same vertical range, so a bed 0.05mm out
 * looked exactly as alarming as one 0.5mm out, and a well-trammed machine
 * rendered as a mountain range. Pinning the scale means relief tracks how bad
 * the bed actually is: flat beds look flat, and two maps can be compared by eye
 * because the exaggeration no longer changes between them.
 */
const REFERENCE_DEVIATION = 0.5;

/**
 * Vertices per side of the rendered mesh, independent of the probe grid.
 *
 * A mesh built one-vertex-per-probe-point is only 16x16 here, and the GPU can
 * do nothing better than interpolate each triangle linearly — so you see the
 * triangles, in the geometry AND in the colour. Sampling a finer mesh through
 * the same bilinear function the 2D canvas uses smooths both at once, for the
 * same reason the 2D view already looks smooth at 96px.
 *
 * 96 is ~9k vertices and ~18k triangles: nothing for the GPU, and it is
 * rebuilt only when the map or an edit changes, never per frame.
 */
const MESH_RESOLUTION = 96;

export interface Surface3D {
	/** Rebuild the mesh from a grid. Cheap enough to call on every edit. */
	setGrid(rows: number[][], meta: HeightMapMeta, extent: number): void;
	/** Mark a point as selected, or null to clear it. */
	setSelected(cell: { row: number; col: number } | null): void;
	resize(): void;
	dispose(): void;
	/** Vertical scale factor currently applied, for the UI to disclose. */
	exaggeration(): number;
}

export function createSurface3D(
	canvas: HTMLCanvasElement,
	/** A probe point was clicked — same act as clicking a dot on the 2D grid. */
	onPick: (row: number, col: number) => void,
): Surface3D {
	const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
	const scene = new Scene(engine);
	// Matches the card ground so the surface floats on the panel, not in a box.
	scene.clearColor = new Color4(0.043, 0.086, 0.149, 1);
	// Ambient floor, so a facet turned away from every light is still readable.
	// Kept LOW on purpose: Babylon's ambient term does not carry vertex colours,
	// so it adds flat grey and desaturates the ramp. Most of the fill therefore
	// comes from the hemispheric light's groundColor below, which multiplies the
	// vertex colour and keeps the hue intact.
	scene.ambientColor = new Color3(0.3, 0.3, 0.3);

	const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3.2, 400, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 0.6;
	camera.lowerRadiusLimit = 80;
	camera.upperRadiusLimit = 1600;
	// Stop short of the poles: passing straight overhead flips the view and
	// loses which way the bed is facing.
	camera.lowerBetaLimit = 0.05;
	camera.upperBetaLimit = Math.PI / 2 - 0.05;

	const light = new HemisphericLight("light", new Vector3(0.3, 1, 0.2), scene);
	light.intensity = 1;
	// groundColor is the FLOOR of the hemispheric term, so it sets how dark an
	// away-facing facet may get. Held high deliberately: the colour carries the
	// number and shading must not be allowed to swallow it — at 0.62 a slope
	// still read as muddy, and a dark red trough was hard to tell from a blue
	// one. The silhouette already conveys the shape (relief is exaggerated
	// ~260x), so shading only needs to hint at it, not model it.
	light.groundColor = new Color3(0.86, 0.86, 0.86);

	const material = new StandardMaterial("surface", scene);
	// Vertex colours carry the meaning; specular highlights would invent
	// features the data does not have.
	material.specularColor = new Color3(0, 0, 0);
	material.backFaceCulling = false;
	// Opt this material into scene.ambientColor (Babylon multiplies the two).
	material.ambientColor = new Color3(1, 1, 1);

	// The probe-point markers, drawn as one thin-instanced sphere. They are the
	// MEASUREMENTS; the surface between them is interpolation, and a smoothed
	// surface with no markers cannot be told apart from densely sampled data.
	// Emissive so they stay legible against every part of the ramp — a white
	// lit sphere disappears into a yellow peak.
	const dotMaterial = new StandardMaterial("probeDot", scene);
	dotMaterial.emissiveColor = new Color3(1, 1, 1);
	dotMaterial.diffuseColor = new Color3(1, 1, 1);
	dotMaterial.specularColor = new Color3(0, 0, 0);
	dotMaterial.disableLighting = true;

	// The selected point, drawn as a slightly larger copper sphere — the same
	// "this one" accent the rest of the UI uses.
	const highlightMaterial = new StandardMaterial("probeSelected", scene);
	highlightMaterial.emissiveColor = new Color3(0.85, 0.52, 0.23);
	highlightMaterial.diffuseColor = new Color3(0.85, 0.52, 0.23);
	highlightMaterial.specularColor = new Color3(0, 0, 0);
	highlightMaterial.disableLighting = true;

	let mesh: Mesh | null = null;
	let dots: Mesh | null = null;
	let highlight: Mesh | null = null;
	let exaggerationFactor = 1;
	/** Columns in the current grid — maps a thin-instance index back to row/col. */
	let gridCols = 0;
	let markerRadius = 1;
	let selected: { row: number; col: number } | null = null;
	let lastRows: number[][] = [];
	let lastMeta: HeightMapMeta | null = null;

	/** Put the highlight on the selected point, or hide it when there is none. */
	const placeHighlight = (): void => {
		highlight?.dispose();
		highlight = null;
		const meta = lastMeta;
		const sel = selected;
		if (sel === null || meta === null) return;
		const numRows = lastRows.length;
		const numCols = numRows === 0 ? 0 : lastRows[0]!.length;
		const value = lastRows[sel.row]?.[sel.col];
		if (numRows < 2 || numCols < 2 || value === undefined) return;
		const spanX = meta.max0 - meta.min0;
		const spanZ = meta.max1 - meta.min1;
		highlight = MeshBuilder.CreateSphere("selected", { diameter: markerRadius * 3.2, segments: 10 }, scene);
		highlight.material = highlightMaterial;
		// Not pickable: it sits over the dot it marks, and picking it would
		// return no thin-instance index and swallow the click.
		highlight.isPickable = false;
		highlight.position = new Vector3(
			(sel.col / (numCols - 1)) * spanX - spanX / 2,
			value * exaggerationFactor,
			(sel.row / (numRows - 1)) * spanZ - spanZ / 2,
		);
	};

	// POINTERPICK, not POINTERDOWN: it fires only on a tap that did not drag, so
	// orbiting the camera across a marker cannot select it by accident.
	// Cursor feedback. Babylon only swaps the cursor for meshes carrying an
	// ActionManager, and these do not — so without this the surface gives no
	// hint that it can be clicked at all, which reads as "not a target".
	scene.onPointerObservable.add(info => {
		if (info.type !== PointerEventTypes.POINTERMOVE) return;
		// Never while dragging: the cursor must keep saying "orbiting", not
		// start advertising a click the drag will not perform.
		if (info.event.buttons !== 0) return;
		const over = scene.pick(scene.pointerX, scene.pointerY);
		canvas.style.cursor = over !== null && over.hit ? "pointer" : "default";
	});

	// Down/up with our own drag threshold, rather than Babylon's POINTERPICK.
	// POINTERPICK carries internal conditions about what was picked on the way
	// down, and a tap that lands on the surface after the camera has moved a
	// pixel or two can silently fail to qualify. Selecting a probe point should
	// not be that delicate — so the rule is stated here: press and release
	// within a few pixels is a click, anything further is an orbit.
	let downAt: { x: number; y: number } | null = null;
	scene.onPointerObservable.add(info => {
		if (info.type === PointerEventTypes.POINTERDOWN) {
			downAt = { x: scene.pointerX, y: scene.pointerY };
			return;
		}
		if (info.type !== PointerEventTypes.POINTERUP) return;
		const start = downAt;
		downAt = null;
		if (start === null) return;
		if (Math.hypot(scene.pointerX - start.x, scene.pointerY - start.y) > 4) return;

		const pick = scene.pick(scene.pointerX, scene.pointerY);
		if (pick === null || !pick.hit) return;

		// A marker was hit directly — exact, no rounding.
		if (pick.pickedMesh === dots) {
			const index = pick.thinInstanceIndex;
			if (index === undefined || index < 0 || gridCols === 0) return;
			onPick(Math.floor(index / gridCols), index % gridCols);
			return;
		}

		// Otherwise fall back to the SURFACE and take the nearest probe point.
		// The markers are ~2mm on a 330mm bed, so demanding a direct hit while
		// the camera is orbiting makes selection a game of darts. Clicking
		// anywhere near a point should choose it — the grid is what is
		// selectable, the sphere is just where it is drawn.
		const meta = lastMeta;
		if (pick.pickedMesh !== mesh || meta === null || pick.pickedPoint === null) return;
		const numRows = lastRows.length;
		const numCols = numRows === 0 ? 0 : lastRows[0]!.length;
		if (numRows < 2 || numCols < 2) return;
		const spanX = meta.max0 - meta.min0;
		const spanZ = meta.max1 - meta.min1;
		const col = Math.round(((pick.pickedPoint.x + spanX / 2) / spanX) * (numCols - 1));
		const row = Math.round(((pick.pickedPoint.z + spanZ / 2) / spanZ) * (numRows - 1));
		onPick(
			Math.max(0, Math.min(numRows - 1, row)),
			Math.max(0, Math.min(numCols - 1, col)),
		);
	});

	const setGrid = (rows: number[][], meta: HeightMapMeta, extent: number): void => {
		mesh?.dispose();
		mesh = null;
		dots?.dispose();
		dots = null;
		lastRows = rows;
		lastMeta = meta;
		const numRows = rows.length;
		const numCols = numRows === 0 ? 0 : rows[0]!.length;
		if (numRows < 2 || numCols < 2) return;

		const spanX = meta.max0 - meta.min0;
		const spanZ = meta.max1 - meta.min1;
		// Scaled to the BED's size (so a 120mm and a 330mm machine both read) but
		// pinned to a fixed deviation, NOT to this map's extent — see
		// REFERENCE_DEVIATION. The factor is therefore the same for every map on
		// a given machine, which is what lets a flat bed look flat.
		exaggerationFactor = (Math.max(spanX, spanZ) * RELIEF_FRACTION) / REFERENCE_DEVIATION;

		// Sample a finer mesh out of the probe grid rather than using it directly:
		// the map is 16x16 SAMPLES OF A SURFACE, not 256 independent readings, so
		// interpolating it is representing it faithfully rather than inventing
		// detail. Same reasoning, and the same function, as the 2D canvas.
		const n = MESH_RESOLUTION;
		const positions: number[] = [];
		const colors: number[] = [];
		for (let r = 0; r < n; r++) {
			const fr = (r / (n - 1)) * (numRows - 1);
			for (let c = 0; c < n; c++) {
				const fc = (c / (n - 1)) * (numCols - 1);
				const value = sampleGridCubic(rows, fc, fr);
				// Centred on the origin so the camera orbits the bed's middle.
				positions.push(
					(c / (n - 1)) * spanX - spanX / 2,
					value * exaggerationFactor,
					(r / (n - 1)) * spanZ - spanZ / 2,
				);
				const { r: cr, g: cg, b: cb } = terrainColor(value, extent);
				colors.push(cr / 255, cg / 255, cb / 255, 1);
			}
		}

		const indices: number[] = [];
		for (let r = 0; r < n - 1; r++) {
			for (let c = 0; c < n - 1; c++) {
				const i0 = r * n + c;
				const i1 = i0 + 1;
				const i2 = i0 + n;
				const i3 = i2 + 1;
				indices.push(i0, i2, i1, i1, i2, i3);
			}
		}

		const data = new VertexData();
		data.positions = positions;
		data.indices = indices;
		data.colors = colors;
		const normals: number[] = [];
		VertexData.ComputeNormals(positions, indices, normals);
		data.normals = normals;

		mesh = new Mesh("heightmap", scene);
		data.applyToMesh(mesh);
		mesh.material = material;

		// One sphere, thin-instanced to every probe point: 256 markers in a
		// single draw call. Sized from the bed so it stays proportionate on any
		// machine, and lifted by its own radius so it rests ON the surface
		// rather than being half-swallowed by it.
		const radius = Math.max(spanX, spanZ) * 0.006;
		dots = MeshBuilder.CreateSphere("probeDots", { diameter: radius * 2, segments: 8 }, scene);
		dots.material = dotMaterial;
		// Clickable: selecting a point to re-probe works here as well as on the
		// 2D grid, so switching view does not cost you the ability to act.
		dots.thinInstanceEnablePicking = true;
		gridCols = numCols;
		const matrices = new Float32Array(numRows * numCols * 16);
		let m = 0;
		for (let r = 0; r < numRows; r++) {
			for (let c = 0; c < numCols; c++) {
				// The MEASURED value at this point, not the interpolated surface:
				// a marker that floated on the smoothed curve would hide exactly
				// the overshoot the smoothing introduces.
				//
				// Centred ON the surface, not resting above it. Lifting by the
				// radius made every marker sit a little proud, which reads as the
				// measurement being above the surface rather than being the point
				// the surface passes through.
				const value = rows[r]![c]!;
				Matrix.Translation(
					(c / (numCols - 1)) * spanX - spanX / 2,
					value * exaggerationFactor,
					(r / (numRows - 1)) * spanZ - spanZ / 2,
				).copyToArray(matrices, m);
				m += 16;
			}
		}
		dots.thinInstanceSetBuffer("matrix", matrices, 16);
		// Without this the mesh keeps the bounding box of the ORIGINAL sphere at
		// the origin, so picking rejects every instance outside it on the cheap
		// bounds test and never reaches the per-instance check. The markers draw
		// correctly either way, which makes it look like a picking bug rather
		// than a stale bounding volume.
		dots.thinInstanceRefreshBoundingInfo(true);
		markerRadius = radius;
		placeHighlight();

		camera.setTarget(Vector3.Zero());
	};

	engine.runRenderLoop(() => scene.render());

	return {
		setGrid,
		setSelected: cell => { selected = cell; placeHighlight(); },
		resize: () => engine.resize(),
		dispose: () => {
			engine.stopRenderLoop();
			mesh?.dispose();
			dots?.dispose();
			highlight?.dispose();
			scene.dispose();
			engine.dispose();
		},
		exaggeration: () => exaggerationFactor,
	};
}
