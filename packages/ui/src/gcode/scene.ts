/**
 * Babylon.js wiring for the G-code toolpath. Imported dynamically (see
 * GcodeViewer.tsx) so the whole Babylon bundle stays out of the initial
 * load — it only ships once Activity's G-code card actually mounts, same
 * lazy-load pattern as src/editor/setup.ts for CodeMirror.
 *
 * This replaces an earlier Three.js implementation (same real-geometry
 * approach: one instanced unit cylinder per segment, transformed to each
 * segment's own position/orientation/width, lit with a real standard
 * material) after Three.js's InstancedMesh rendered every segment as flat
 * gray — correct, verified-varied per-instance color data never reached
 * the final pixels, even with the material's own base color forced to
 * red, despite the shader-compile path checking out against Three's own
 * source. A from-scratch spike of the identical approach (instanced
 * cylinders, per-instance RGB, comparable lighting) in Babylon.js worked
 * correctly on the first try, so the toolpath renderer moved here rather
 * than continuing to chase an unexplained Three-specific bug.
 *
 * Coordinate convention: gcode/RRF space is Z-up ((x, y, z) with z the
 * build height); Babylon's camera/orbit math (ArcRotateCamera) assumes
 * Y-up. Rather than fight that assumption, every position this file hands
 * to Babylon goes through toBabylon(), which swaps y/z once at the
 * boundary — internally everything after that point is ordinary Babylon
 * Y-up space.
 *
 * Opaque (already-printed/in-focus) and ghost (translucent preview)
 * segments are rendered as SEPARATE meshes, but BOTH are fully opaque
 * (non-blended) materials — ghost's "translucency" is faked by lerping
 * each segment's own color toward the scene's background color on the
 * CPU (see ghostColor()) rather than using real GPU alpha blending.
 *
 * This replaces an earlier attempt at real alpha blending + forceDepthWrite
 * (write real depth from a transparent material so the GPU's depth test
 * keeps only the nearest ghost fragment, preventing N-overlapping-layers
 * alpha compounding toward full opacity). That only works if fragments are
 * submitted in strict front-to-back order for the CURRENT camera angle;
 * our thin-instance buffers are built in gcode/segment order (bottom to
 * top), which is fixed regardless of viewing angle, so for most camera
 * angles a later (not-yet-known-to-be-nearer) fragment still passes its
 * depth test against whatever was drawn immediately before it and blends
 * again — compounding across however many instances happen to look
 * progressively nearer in submission order, not just once. Visually this
 * showed up as the ghost preview looking solid/opaque within the first
 * ~10-15 overlapping layers (0.65^10 ≈ 1% of the original color left) —
 * a band that appeared to "print" extra layers, tracking wherever the
 * reveal boundary currently was. Baking the fade into the color itself
 * sidesteps the whole problem: both meshes render fully opaque, so a
 * plain depth test (no blending, no ordering sensitivity) resolves
 * occlusion correctly regardless of instance submission order.
 *
 * renderModes.ts guarantees the opaque/ghost classification is always a
 * contiguous segment range, but travel (non-extruding) moves are scattered
 * throughout every range, not contiguous — so opaque/ghost mesh building
 * filters each range down to extruding-only segments (an actual copy, not
 * a zero-copy subarray) rather than relying on range slicing alone. Travel
 * moves get their own separate mesh, built once at load (their geometry
 * never changes tick to tick) with a fixed uniform color rather than the
 * active color mode's hue, and hidden by default — not part of the
 * opaque/ghost pass at all, toggled independently via setTravelVisible.
 */
// Imported from Babylon's individual per-feature entry points, not the
// "@babylonjs/core" barrel — the barrel pulls in the whole engine (PBR
// materials, gaussian splatting, spatial WebAudio, texture-compression
// decoders...) regardless of what's actually used, blowing the lazy
// gcode-viewer chunk out to multiple megabytes gzipped. This is Babylon's
// own documented tree-shaking pattern for production bundles.
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Camera } from "@babylonjs/core/Cameras/camera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder.js"; // registers MeshBuilder.CreateCylinder (nozzle marker)
import "@babylonjs/core/Meshes/Builders/boxBuilder.js"; // registers MeshBuilder.CreateBox (toolpath tube cross-section)
// Bare side-effect imports: Babylon's per-feature tree-shaking pattern
// silently INSTALLS A NO-OP STUB for methods like Mesh.prototype.clone /
// thinInstanceSetBuffer unless the module that provides the real
// implementation is imported somewhere for its side effect — a `import
// type` (or never importing the file at all) doesn't trigger it, and the
// stub neither throws nor logs by default, so every thin-instance call
// silently did nothing (thinInstanceCount stayed undefined, the mesh's
// bounding info never grew past the base cylinder's own tiny local
// bounds, and nothing rendered) with zero errors anywhere. This is what
// actually made the toolpath invisible, not the camera/culling work above.
import "@babylonjs/core/Meshes/mesh.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import type { GhostRanges, SegmentRange } from "./renderModes.ts";

const TRAVEL_COLOR = new Color3(0.85, 0.85, 0.9);
// Ghost opacity: the real GPU alpha applied to each not-yet-printed segment.
const GHOST_ALPHA = 0.5;

/** gcode/RRF is Z-up; Babylon's ArcRotateCamera assumes Y-up. Swap once, here, at the boundary. */
const toBabylon = (x: number, y: number, z: number): Vector3 => new Vector3(x, z, y);

export interface SceneHandle {
	/** (Re)builds every mesh from scratch, including the travel mesh — called once per parsed file.
	 *  `hue` is per-segment RGB (3 floats/segment, already linear — see hueColors.ts), NOT the old per-vertex RGBA. */
	setGeometry(
		positions: Float32Array, hue: Float32Array, widths: Float32Array, extruding: Uint8Array,
		opaqueRange: SegmentRange, ghostRanges: GhostRanges,
	): void;
	/** Rewrites colors and re-splits the opaque/ghost meshes — called on every live position tick. Travel's own mesh is untouched (its geometry/color never changes tick to tick). */
	updateColors(hue: Float32Array, opaqueRange: SegmentRange, ghostRanges: GhostRanges): void;
	/** Shows or hides the (always-built, separately-colored) travel-move mesh. */
	setTravelVisible(visible: boolean): void;
	/** Moves the tool-position marker to the current head position, or hides it (null — nothing printing/no live position). */
	setToolPosition(position: readonly [number, number, number] | null): void;
	resize(width: number, height: number): void;
	destroy(): void;
}

/** Shortest-arc rotation quaternion taking unit vector `from` onto unit vector `to`. */
function quaternionBetween(from: Vector3, to: Vector3): Quaternion {
	const dot = Vector3.Dot(from, to);
	if (dot < -0.999999) {
		// Antipodal: any perpendicular axis works for a 180° turn.
		let axis = Vector3.Cross(Vector3.Right(), from);
		if (axis.lengthSquared() < 1e-9) axis = Vector3.Cross(Vector3.Up(), from);
		axis.normalize();
		return Quaternion.RotationAxis(axis, Math.PI);
	}
	const axis = Vector3.Cross(from, to);
	const s = Math.sqrt((1 + dot) * 2);
	const invs = 1 / s;
	return new Quaternion(axis.x * invs, axis.y * invs, axis.z * invs, s * 0.5);
}

export function createScene(
	canvas: HTMLCanvasElement, width: number, height: number, bedCenter: { x: number; y: number }, bedExtent: number,
): SceneHandle {
	const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false }, true);
	engine.setSize(width, height);

	const scene = new Scene(engine);
	scene.clearColor = new Color4(0x0a / 255, 0x14 / 255, 0x20 / 255, 1);

	const target = toBabylon(bedCenter.x, bedCenter.y, 0);

	// On-demand rendering: a large toolpath is real per-frame GPU cost, and
	// a static preview has nothing new to draw most of the time. Render
	// only when the camera actually moves or geometry/colors change — never
	// on an unconditional 60fps loop (no engine.runRenderLoop). Declared
	// before the camera/zoom setup below so the wheel handler can call it
	// directly.
	let pendingFrame = 0;
	const renderFrame = (): void => {
		pendingFrame = 0;
		scene.render();
	};
	const requestRender = (): void => {
		if (pendingFrame !== 0) return;
		pendingFrame = requestAnimationFrame(renderFrame);
	};

	// Orthographic, not perspective: no foreshortening, so parallel walls
	// stay parallel and widths read consistently regardless of depth —
	// closer to how a real slicer preview or technical drawing looks.
	// FRUSTUM_SIZE is the initial visible height in mm; ArcRotateCamera
	// zooms an orthographic camera via ortho{Left,Right,Top,Bottom} (not
	// dolly distance), so resize() only needs to redo the aspect split.
	// 200 didn't comfortably fit a real ~300mm bed (confirmed against the
	// Position card's own Y-axis max) — too-tight orthographic bounds crop
	// the model at the frustum's edge, which reads the same as "clipping"
	// even though it's a different mechanism than the near/far Z range
	// below. The user can always zoom in further; this only sets the
	// default, un-zoomed view.
	const FRUSTUM_SIZE = 350;
	const camera = new ArcRotateCamera(
		"camera",
		-Math.PI / 4, // alpha (matches the old (bedCenter+100, bedCenter+100, 150) 45°-ish vantage)
		Math.PI / 3.2, // beta
		250, // radius (orthographic ignores this for projection, but it's still the pivot distance for controls)
		target,
		scene,
	);
	camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
	// attachControl's 2nd parameter is `noPreventDefault`, NOT the element
	// (that's legacy-ignored — Babylon attaches to the canvas via the
	// engine automatically). Passing `true` here was telling Babylon's own
	// wheel/pointer handling to skip calling preventDefault() on every
	// wheel/gesture event — the exact opposite of what's needed, so
	// scrolling (and trackpad two-finger zoom, which browsers simulate as
	// wheel events with ctrlKey set) fell through to the browser's own
	// page scroll/zoom instead of driving the camera.
	camera.attachControl(canvas, false);
	camera.panningSensibility = 100; // ArcRotateCamera default is tuned for perspective-scale scenes; lower = more sensitive
	// Orbit around the bed's actual center (from the machine's real axis
	// min/max, not a guessed default) — set once here, not re-derived from
	// wherever the camera/model happens to be, so rotating always pivots
	// around the same fixed point regardless of what's loaded or how far
	// the user has panned/zoomed. ArcRotateCamera's own panning moves
	// `target` together with the camera, so panning keeps this pivot
	// wherever the user drags it — it doesn't detach the orbit center.
	camera.target.copyFrom(target);

	// ArcRotateCamera's built-in mouse-wheel AND pinch/touch inputs both only
	// adjust `radius`, which an orthographic projection ignores entirely
	// (it's driven purely by ortho{Left,Right,Top,Bottom}) — scrolling or
	// pinching would silently do nothing. Rather than reimplement zoom
	// separately per input device, keep radius as the single source of
	// truth Babylon's own inputs already drive (wheel, pinch-to-zoom,
	// double-tap, whatever else it adds) and re-derive the ortho frustum
	// from it on every camera change — one mechanism covers every input.
	const INITIAL_RADIUS = 250;
	const ZOOM_MIN = 0.05, ZOOM_MAX = 20;
	camera.lowerRadiusLimit = INITIAL_RADIUS / ZOOM_MAX;
	camera.upperRadiusLimit = INITIAL_RADIUS / ZOOM_MIN;
	let currentWidth = width, currentHeight = height;

	// Root cause of the long-running "clipping"/"solid section missing"
	// symptom: for an ORTHOGRAPHIC camera the near plane may legitimately be
	// NEGATIVE — geometry between the camera position and the target (and
	// even slightly behind the camera) still projects validly, unlike a
	// perspective camera where near must be > 0. The camera orbits at
	// `radius` from the target with the model spanning ±bedExtent around
	// that target, so the nearest geometry sits at roughly `radius -
	// bedExtent` in view-Z, which is well negative at normal zoom. Clamping
	// minZ to a positive floor (the old `Math.max(0.1, …)`) forced the near
	// plane in FRONT of the camera and clipped away everything nearer than
	// it — i.e. exactly the solid/near section of the model, measured
	// directly via a per-corner view-Z probe (a corner at view-Z −72 vs a
	// minZ floor of 0.1). So: no positive clamp. The near/far span is kept
	// as tight as the model actually needs (radius ± a bedExtent-derived
	// margin, a real bound from the machine's reported axis limits — see
	// GcodeViewer.tsx — not a guessed constant) to preserve orthographic
	// depth-buffer precision, which is spread linearly across the whole
	// span and degrades into z-fighting/moiré if the span is bloated.
	const MODEL_DEPTH_MARGIN = bedExtent * 1.2;

	const setOrthoFrustum = (w: number, h: number): void => {
		currentWidth = w;
		currentHeight = h;
		camera.minZ = camera.radius - MODEL_DEPTH_MARGIN; // may be negative — valid and REQUIRED for ortho, see above
		camera.maxZ = camera.radius + MODEL_DEPTH_MARGIN;
		const zoomFactor = INITIAL_RADIUS / camera.radius;
		const aspect = w / h;
		const size = FRUSTUM_SIZE / zoomFactor;
		camera.orthoLeft = -size * aspect / 2;
		camera.orthoRight = size * aspect / 2;
		camera.orthoTop = size / 2;
		camera.orthoBottom = -size / 2;
	};
	setOrthoFrustum(width, height);

	// One shared light position for the whole scene.
	const LIGHT_POSITION = toBabylon(bedCenter.x, bedCenter.y, 600);

	// Moderate ambient (hemispheric, angle-independent) so the base color
	// stays legible on faces angled away from the spotlight; the spotlight
	// below still adds real directional shading on top.
	const hemi = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
	hemi.intensity = 0.9;
	// StandardMaterial's (non-PBR) lighting is NOT physically based: its
	// default falloff is attenuation = max(0, 1 - distance/light.range),
	// with `range` defaulting to ~1.8e308 (effectively infinite) — so at
	// our mm-scale distances there is NO meaningful distance falloff at
	// all, and `intensity` is just a near-direct multiplier on the light's
	// diffuse/specular contribution. A million-scale value (carried over
	// from an earlier, unrelated physically-correct-units assumption)
	// blew every lit surface out to pure white, crushing both the real
	// per-segment colors and ghost's whole washed-toward-background fade
	// into the same flat white — "high contrast" was actually total loss
	// of color information on every lit face, not a genuine light/shadow
	// contrast. A small, direct-multiplier-scale value here instead.
	const spotDirection = target.subtract(LIGHT_POSITION).normalize();
	const spotLight = new SpotLight("spot", LIGHT_POSITION, spotDirection, Math.PI / 2, 2, scene);
	spotLight.intensity = 4;

	// Real lit materials for the toolpath itself — low specular, moderate
	// roughness, reading as glossy plastic rather than the nozzle marker's
	// brass. Per-instance color comes from each mesh's thin-instance color
	// buffer (see buildMesh) — Babylon multiplies it into diffuseColor
	// automatically once a thin-instance color buffer is set.
	const opaqueMaterial = new StandardMaterial("opaque", scene);
	opaqueMaterial.specularColor = new Color3(0.15, 0.15, 0.15);
	// Ghost preview material: REAL alpha transparency, so every not-yet-
	// printed layer behind a nearer one still shows through (the whole point
	// — "see all the layers"). A baked color-fade on opaque geometry can
	// only ever look like a desaturated SOLID (nearest surface wins, nothing
	// behind it visible); genuine translucency requires actual alpha blend.
	//   - alpha low (GHOST_ALPHA) so the ghost reads as a faint preview.
	//   - specular black: no glossy highlight. A reflection reads as a solid
	//     surface catching light; killing it keeps the ghost matte, more
	//     like looking THROUGH tinted material than AT a shiny object.
	//   - a depth pre-pass (needDepthPrePass, below) makes each pixel a
	//     single GHOST_ALPHA blend of the nearest ghost surface, so
	//     overlapping ghost layers do NOT accumulate toward opaque — the
	//     ghost stays uniformly faint regardless of how many layers stack
	//     behind a pixel. It still depth-tests against the already-printed
	//     opaque, so ghost geometry behind the solid is correctly hidden.
	const ghostMaterial = new StandardMaterial("ghost", scene);
	ghostMaterial.specularColor = Color3.Black();
	ghostMaterial.alpha = GHOST_ALPHA;
	// Depth pre-pass: render the ghost's depth first (view-independent), then
	// blend only the frontmost fragment per pixel in the color pass. This
	// stops the ghost's overlapping layers from accumulating toward opaque —
	// every pixel is a single GHOST_ALPHA blend of just the nearest ghost
	// surface, so the ghost stays uniformly faint at any depth/angle. Costs a
	// second (depth-only) draw of this mesh, but keeps the translucency
	// honest instead of density-dependent. It still depth-tests against the
	// already-printed opaque, so the ghost stays physically ordered in space.
	ghostMaterial.needDepthPrePass = true;
	// Travel moves: a real solid pass (same depth semantics as opaque) but
	// its own fixed color, independent of whatever hue the active color
	// mode assigns — travel isn't a "feature," so it doesn't participate
	// in feature-type/speed/layer-time coloring at all.
	const travelMaterial = new StandardMaterial("travel", scene);
	travelMaterial.diffuseColor = TRAVEL_COLOR;
	travelMaterial.specularColor = new Color3(0.1, 0.1, 0.1);

	// A typical nozzle's real shape: a wide body tapering to a fine tip.
	// diameterTop is the WIDE end, diameterBottom the NARROW tip; Babylon's
	// cylinder is centered on its own origin by default, so we translate
	// the mesh's pivot down to the tip (Y=-H/2 in local space) via
	// bakeCurrentTransformIntoVertices, mirroring the old Three geometry
	// translate — setting the mesh's position to the live head coordinate
	// then plants the tip exactly there, with the wide body above it.
	const NOZZLE_HEIGHT = 6;
	const marker = MeshBuilder.CreateCylinder("nozzle", {
		diameterTop: 4, diameterBottom: 0.6, height: NOZZLE_HEIGHT, tessellation: 24,
	}, scene);
	marker.position.y = NOZZLE_HEIGHT / 2;
	marker.bakeCurrentTransformIntoVertices();
	// Rough metallic, not polished: a soft, broad specular highlight rather
	// than a tight mirror-like point — reads as a worn/machined brass
	// nozzle instead of a chrome ball.
	const markerMaterial = new StandardMaterial("nozzleMat", scene);
	markerMaterial.diffuseColor = Color3.FromHexString("#b5a642");
	markerMaterial.specularColor = new Color3(0.5, 0.45, 0.3);
	markerMaterial.specularPower = 16;
	marker.material = markerMaterial;
	marker.setEnabled(false);

	// Unit box (rectangular cross-section, 1×1×1 so scaling.x/z = the
	// segment's real width and scaling.y = its real length directly) — a
	// hidden template each mesh clones. A box instead of a round cylinder is
	// both cheaper (8 verts / 12 tris vs a tessellated cylinder's many more)
	// and a better match for a real FDM bead, which is a flat-topped
	// rectangle, not a circle. Fewer, flatter faces also give the dense
	// parallel runs less fine edge detail to shimmer against the pixel grid.
	const tubeTemplate = MeshBuilder.CreateBox("tubeTemplate", {
		width: 1, height: 1, depth: 1,
	}, scene);
	tubeTemplate.setEnabled(false);
	tubeTemplate.isVisible = false;

	let instanceMatrices: Float32Array | null = null;
	let fullExtruding: Uint8Array | null = null;
	let opaqueMesh: Mesh | null = null;
	let ghostBeforeMesh: Mesh | null = null;
	let ghostAfterMesh: Mesh | null = null;
	let travelMesh: Mesh | null = null;

	const onCameraChanged = (): void => {
		setOrthoFrustum(currentWidth, currentHeight);
		requestRender();
	};
	camera.onViewMatrixChangedObservable.add(onCameraChanged);
	requestRender();

	const disposeAll = (): void => {
		for (const mesh of [opaqueMesh, ghostBeforeMesh, ghostAfterMesh]) mesh?.dispose();
		opaqueMesh = null;
		ghostBeforeMesh = null;
		ghostAfterMesh = null;
	};

	const disposeTravel = (): void => {
		travelMesh?.dispose();
		travelMesh = null;
	};

	/** One 4x4 transform per segment: position at its midpoint, oriented from local +Y onto the segment's own direction, scaled to its real length/width. */
	const computeInstanceMatrices = (positions: Float32Array, widths: Float32Array): Float32Array => {
		const segmentCount = widths.length;
		const matrices = new Float32Array(segmentCount * 16);
		const yAxis = Vector3.Up();
		const scratch = new Matrix();
		for (let i = 0; i < segmentCount; i++) {
			const base = i * 6;
			const start = toBabylon(positions[base]!, positions[base + 1]!, positions[base + 2]!);
			const end = toBabylon(positions[base + 3]!, positions[base + 4]!, positions[base + 5]!);
			const mid = start.add(end).scale(0.5);
			const dir = end.subtract(start);
			const length = dir.length();
			let rotation: Quaternion;
			if (length > 1e-6) {
				dir.scaleInPlace(1 / length);
				rotation = quaternionBetween(yAxis, dir);
			} else {
				rotation = Quaternion.Identity();
			}
			const width = widths[i]!;
			const scaling = new Vector3(width, Math.max(length, 1e-4), width);
			Matrix.ComposeToRef(scaling, rotation, mid, scratch);
			scratch.copyToArray(matrices, i * 16);
		}
		return matrices;
	};

	/** hueColors.ts writes 2 (duplicate) vertices per segment; an instance only needs one color, so take the first. */
	const extractInstanceColors = (hue: Float32Array, segmentCount: number): Float32Array => {
		const colors = new Float32Array(segmentCount * 4);
		for (let i = 0; i < segmentCount; i++) {
			const base = i * 6;
			colors[i * 4] = hue[base]!; colors[i * 4 + 1] = hue[base + 1]!; colors[i * 4 + 2] = hue[base + 2]!;
			colors[i * 4 + 3] = 1;
		}
		return colors;
	};

	/** Fills (or refills) a thin-instanced clone of the tube template from `range`, filtered down to segments whose `extruding` flag matches `wantExtruding`.
	 *  Travel moves are scattered throughout every contiguous range, so this is an actual filter (a copy), not a zero-copy subarray.
	 *
	 *  Reuses `existing` in place (just rewriting its thin-instance buffers)
	 *  rather than disposing and cloning a fresh mesh every call. Measured
	 *  live: building a brand-new mesh (clone + first buffer upload) itself
	 *  only took ~250ms, but scene.isReady() then took another ~650-700ms
	 *  to confirm — a real, roughly fixed per-NEW-mesh cost (first-ever
	 *  submesh/effect binding validation), not something proportional to
	 *  instance count. Since a live print's recolor() tick fires about
	 *  once a second, and the opaque/ghost split is rebuilt every tick, a
	 *  fresh clone every tick meant the old mesh was disposed immediately
	 *  but the new one didn't confirm ready until ~900ms later — visible
	 *  as the model flashing hidden/revealed on a ~1s cycle, forever, since
	 *  the next tick's dispose landed right as the previous one finally
	 *  became visible. A mesh that already rendered once doesn't pay that
	 *  cost again just because its buffer *content* changes. */
	const buildMesh = (
		existing: Mesh | null,
		matrices: Float32Array, colors: Float32Array | null, extruding: Uint8Array,
		range: SegmentRange, wantExtruding: boolean, material: StandardMaterial, name: string,
	): Mesh | null => {
		let matchCount = 0;
		for (let i = range.start; i < range.end; i++) if ((extruding[i] === 1) === wantExtruding) matchCount++;
		if (matchCount === 0) {
			existing?.setEnabled(false);
			return existing;
		}

		const outMatrices = new Float32Array(matchCount * 16);
		const outColors = colors !== null ? new Float32Array(matchCount * 4) : null;
		let o = 0;
		for (let i = range.start; i < range.end; i++) {
			if ((extruding[i] === 1) !== wantExtruding) continue;
			outMatrices.set(matrices.subarray(i * 16, i * 16 + 16), o * 16);
			if (outColors !== null && colors !== null) outColors.set(colors.subarray(i * 4, i * 4 + 4), o * 4);
			o++;
		}

		const mesh = existing ?? tubeTemplate.clone(name);
		if (existing === null) {
			// CRITICAL: clone() SHARES the underlying geometry with the
			// template (and thus with every other clone). thinInstanceSetBuffer
			// registers its per-instance matrix/color buffers as vertex buffers
			// ON THE GEOMETRY (mesh.setVerticesBuffer → geometry.setVerticesBuffer),
			// so with a shared geometry each mesh's instance buffers overwrite
			// the others' — whichever mesh is built LAST wins, and all of them
			// then render that mesh's instances. In Preview the ghost is built
			// after the opaque, so the opaque rendered the ghost's cyan
			// geometry (magenta vanished); in Hide only the opaque is built so
			// it looked fine. makeGeometryUnique() gives this mesh its own
			// geometry so its thin-instance buffers are truly private.
			mesh.makeGeometryUnique();
			mesh.material = material;
			// Thin instances don't expand the mesh's own bounding info (it
			// stays the base unit cylinder's tiny local AABB at the
			// origin), so Babylon's frustum culling — which checks that
			// bounding box against the camera — wrongly decides the whole
			// mesh is off-screen and skips it. Recomputing the bounding
			// info on every buffer update would work but is easy to forget
			// after a future edit; skipping culling entirely for these
			// meshes is simpler and correct by construction, and this app
			// only ever has one bed-sized model in view at a time, so
			// there's no real culling benefit being given up.
			mesh.alwaysSelectAsActiveMesh = true;
		}
		mesh.setEnabled(true);
		mesh.isVisible = true;
		// staticBuffer=false: these buffers legitimately get rewritten every
		// recolor() tick (a live print's opaque/ghost split moves), unlike
		// travel's build-once-at-load buffer below.
		mesh.thinInstanceSetBuffer("matrix", outMatrices, 16, false);
		if (outColors !== null) mesh.thinInstanceSetBuffer("color", outColors, 4, false);
		return mesh;
	};

	const rebuild = (colors: Float32Array, opaqueRange: SegmentRange, ghostRanges: GhostRanges): void => {
		if (instanceMatrices === null || fullExtruding === null) return;
		// Ghost and opaque share the same real per-segment colors — the
		// ghost's translucency comes from ghostMaterial's real alpha.
		opaqueMesh = buildMesh(opaqueMesh, instanceMatrices, colors, fullExtruding, opaqueRange, true, opaqueMaterial, "opaque");
		ghostBeforeMesh = buildMesh(ghostBeforeMesh, instanceMatrices, colors, fullExtruding, ghostRanges.before, true, ghostMaterial, "ghostBefore");
		ghostAfterMesh = buildMesh(ghostAfterMesh, instanceMatrices, colors, fullExtruding, ghostRanges.after, true, ghostMaterial, "ghostAfter");
		requestRender();
		// A freshly built mesh's material shader compiles asynchronously —
		// on-demand rendering (no continuous runRenderLoop) means the render
		// just triggered above can fire before that compile finishes, and
		// Babylon silently skips drawing any mesh that isn't ready yet with
		// nothing to prompt a later retry. executeWhenReady's callback fires
		// once every pending resource (including shader compilation) is
		// actually ready, so this guarantees the real first paint happens.
		// This only matters the first time a mesh is created now (buildMesh
		// reuses existing meshes on every later call), so it's a one-time
		// cost per mesh instead of a recurring one on every tick.
		scene.executeWhenReady(requestRender);
	};

	return {
		setGeometry(positions, hue, widths, extruding, opaqueRange, ghostRanges) {
			instanceMatrices = computeInstanceMatrices(positions, widths);
			fullExtruding = extruding;
			const instanceColors = extractInstanceColors(hue, extruding.length);

			disposeTravel();
			travelMesh = buildMesh(null, instanceMatrices, null, extruding, { start: 0, end: extruding.length }, false, travelMaterial, "travel");
			if (travelMesh !== null) travelMesh.setEnabled(false);

			rebuild(instanceColors, opaqueRange, ghostRanges);
		},
		updateColors(hue, opaqueRange, ghostRanges) {
			if (fullExtruding === null) return;
			const instanceColors = extractInstanceColors(hue, fullExtruding.length);
			rebuild(instanceColors, opaqueRange, ghostRanges);
		},
		setTravelVisible(visible) {
			travelMesh?.setEnabled(visible);
			requestRender();
		},
		setToolPosition(position) {
			marker.setEnabled(position !== null);
			if (position !== null) marker.position.copyFrom(toBabylon(position[0], position[1], position[2]));
			requestRender();
		},
		resize(w, h) {
			engine.setSize(w, h);
			setOrthoFrustum(w, h);
			requestRender();
		},
		destroy() {
			cancelAnimationFrame(pendingFrame);
			camera.onViewMatrixChangedObservable.removeCallback(onCameraChanged);
			disposeAll();
			disposeTravel();
			tubeTemplate.dispose();
			opaqueMaterial.dispose();
			ghostMaterial.dispose();
			travelMaterial.dispose();
			marker.dispose();
			markerMaterial.dispose();
			scene.dispose();
			engine.dispose();
		},
	};
}
