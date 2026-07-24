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
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { terrainColor } from "./surface.ts";
import type { HeightMapMeta } from "./parse.ts";

/** The largest deviation is drawn as this fraction of the bed's longer side. */
const RELIEF_FRACTION = 0.12;

export interface Surface3D {
	/** Rebuild the mesh from a grid. Cheap enough to call on every edit. */
	setGrid(rows: number[][], meta: HeightMapMeta, extent: number): void;
	resize(): void;
	dispose(): void;
	/** Vertical scale factor currently applied, for the UI to disclose. */
	exaggeration(): number;
}

export function createSurface3D(canvas: HTMLCanvasElement): Surface3D {
	const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
	const scene = new Scene(engine);
	// Matches the card ground so the surface floats on the panel, not in a box.
	scene.clearColor = new Color4(0.043, 0.086, 0.149, 1);
	// Ambient floor, so a facet turned away from every light is still readable.
	// Kept LOW on purpose: Babylon's ambient term does not carry vertex colours,
	// so it adds flat grey and desaturates the ramp. Most of the fill therefore
	// comes from the hemispheric light's groundColor below, which multiplies the
	// vertex colour and keeps the hue intact.
	scene.ambientColor = new Color3(0.18, 0.18, 0.18);

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
	light.intensity = 0.95;
	// Fill from below so no facet falls to black. Shading conveys SHAPE, but the
	// colour conveys the number, and an unlit slope was losing the second to the
	// first — a deep red trough rendered nearly as dark as a blue one.
	light.groundColor = new Color3(0.62, 0.62, 0.62);

	const material = new StandardMaterial("surface", scene);
	// Vertex colours carry the meaning; specular highlights would invent
	// features the data does not have.
	material.specularColor = new Color3(0, 0, 0);
	material.backFaceCulling = false;
	// Opt this material into scene.ambientColor (Babylon multiplies the two).
	material.ambientColor = new Color3(1, 1, 1);

	let mesh: Mesh | null = null;
	let exaggerationFactor = 1;

	const setGrid = (rows: number[][], meta: HeightMapMeta, extent: number): void => {
		mesh?.dispose();
		mesh = null;
		const numRows = rows.length;
		const numCols = numRows === 0 ? 0 : rows[0]!.length;
		if (numRows < 2 || numCols < 2) return;

		const spanX = meta.max0 - meta.min0;
		const spanZ = meta.max1 - meta.min1;
		// Scale the relief to the bed, not to a constant: a 120mm bed and a 330mm
		// bed must both show their deviation at a readable height.
		exaggerationFactor = extent === 0 ? 1 : (Math.max(spanX, spanZ) * RELIEF_FRACTION) / extent;

		const positions: number[] = [];
		const colors: number[] = [];
		for (let r = 0; r < numRows; r++) {
			for (let c = 0; c < numCols; c++) {
				const value = rows[r]![c]!;
				// Centred on the origin so the camera orbits the bed's middle.
				positions.push(
					meta.min0 + (c / (numCols - 1)) * spanX - spanX / 2,
					value * exaggerationFactor,
					meta.min1 + (r / (numRows - 1)) * spanZ - spanZ / 2,
				);
				const { r: cr, g: cg, b: cb } = terrainColor(value, extent);
				colors.push(cr / 255, cg / 255, cb / 255, 1);
			}
		}

		const indices: number[] = [];
		for (let r = 0; r < numRows - 1; r++) {
			for (let c = 0; c < numCols - 1; c++) {
				const i0 = r * numCols + c;
				const i1 = i0 + 1;
				const i2 = i0 + numCols;
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
		camera.setTarget(Vector3.Zero());
	};

	engine.runRenderLoop(() => scene.render());

	return {
		setGrid,
		resize: () => engine.resize(),
		dispose: () => {
			engine.stopRenderLoop();
			mesh?.dispose();
			scene.dispose();
			engine.dispose();
		},
		exaggeration: () => exaggerationFactor,
	};
}
