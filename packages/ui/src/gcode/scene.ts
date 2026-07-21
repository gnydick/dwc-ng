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
import "@babylonjs/core/Meshes/Builders/cylinderBuilder.js"; // registers MeshBuilder.CreateCylinder (bead cross-section + nozzle marker)
import "@babylonjs/core/Meshes/Builders/boxBuilder.js"; // registers MeshBuilder.CreateBox (toolpath tube cross-section)
import "@babylonjs/core/Meshes/Builders/groundBuilder.js"; // registers MeshBuilder.CreateGround (reference bed plane)
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
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import type { GhostRanges, SegmentRange } from "./renderModes.ts";
import { mergeExtrudingRuns } from "./mergeSegments.ts";

const TRAVEL_COLOR = new Color3(0.85, 0.85, 0.9);
// Ghost opacity: the real GPU alpha applied to each not-yet-printed segment.
const GHOST_ALPHA = 0.5;
/** Deviation bound for the GHOST run table. Far looser than the opaque set's
 *  (mergeSegments' DEFAULT_TOLERANCE_MM): the ghost is a 50%-alpha preview of
 *  unprinted toolpath, where sub-millimetre chord error is invisible, and it is
 *  the bulk of the scene early in a print. Measured on the real 800-layer job:
 *  0.05mm -> 1,181,524 instances, 0.3mm -> 728,546 (-38% on the ghost set). */
const GHOST_TOLERANCE_MM = 0.1;

/** gcode/RRF is Z-up; Babylon's ArcRotateCamera assumes Y-up. Swap once, here, at the boundary. */
const toBabylon = (x: number, y: number, z: number): Vector3 => new Vector3(x, z, y);

export interface SceneHandle {
	/** (Re)builds every mesh from scratch, including the travel mesh — called once per parsed file.
	 *  `hue` is per-segment RGB (6 floats/segment, RGB duplicated, already linear — see hueColors.ts).
	 *  `layerIndex` (per segment) bounds collinear-run merging so a merged run never crosses a layer. */
	setGeometry(
		positions: Float32Array, hue: Float32Array, widths: Float32Array, extruding: Uint8Array, layerIndex: Uint16Array,
		layerHeights: Float32Array, opaqueRange: SegmentRange, ghostRanges: GhostRanges,
	): void;
	/** Rebuilds the per-run color buffers (color MODE changed) and re-applies the split. Infrequent — not the live tick. */
	updateColors(hue: Float32Array, opaqueRange: SegmentRange, ghostRanges: GhostRanges): void;
	/** The live hot path: re-applies the opaque/ghost split for a new position/reveal/ghost mode. In the prefix case this is just two thinInstanceCount updates — no geometry or color upload. */
	updatePosition(opaqueRange: SegmentRange, ghostRanges: GhostRanges): void;
	/** Shows or hides the (always-built, separately-colored) travel-move mesh. */
	setTravelVisible(visible: boolean): void;
	/** Moves the tool-position marker to the current head position, or hides it (null — nothing printing/no live position). */
	setToolPosition(position: readonly [number, number, number] | null): void;
	resize(width: number, height: number): void;
	destroy(): void;
}

export function createScene(
	canvas: HTMLCanvasElement, width: number, height: number,
	bedCenter: { x: number; y: number }, bedExtent: number, bedSize: { x: number; y: number },
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

	// PERSPECTIVE with a LONG focal length. Straight orthographic reads as a
	// technical drawing and gives no depth cue; a normal ~45° game FOV distorts
	// a 300mm bed badly at the edges. A narrow FOV is the photographer's answer —
	// a long lens compresses perspective, so verticals stay near-parallel and the
	// foreshortening is just enough to read depth.
	// FOV↔focal length (35mm-equivalent, 24mm frame height): fov = 2·atan(12/f);
	// 15° ≈ a 90mm lens — gentle portrait-length compression.
	// FRUSTUM_SIZE is the initial visible height in mm AT THE TARGET; under
	// perspective that fixes the DISTANCE rather than an ortho box:
	// height = 2·d·tan(fov/2)  ⇒  d = height / (2·tan(fov/2)).
	// 200 didn't comfortably fit a real ~300mm bed (confirmed against the
	// Position card's own Y-axis max) — too-tight orthographic bounds crop
	// the model at the frustum's edge, which reads the same as "clipping"
	// even though it's a different mechanism than the near/far Z range
	// below. The user can always zoom in further; this only sets the
	// default, un-zoomed view.
	const FRUSTUM_SIZE = 350;
	const CAMERA_FOV = 15 * Math.PI / 180; // radians (vertical) — ≈90mm equivalent
	/** Distance at which `viewHeightMm` fills the view height at this FOV. */
	const distanceFor = (viewHeightMm: number): number => viewHeightMm / (2 * Math.tan(CAMERA_FOV / 2));
	const INITIAL_RADIUS = distanceFor(FRUSTUM_SIZE);
	const camera = new ArcRotateCamera(
		"camera",
		-Math.PI / 4, // alpha (matches the old (bedCenter+100, bedCenter+100, 150) 45°-ish vantage)
		Math.PI / 3.2, // beta
		INITIAL_RADIUS, // real dolly distance now — perspective zoom IS radius
		target,
		scene,
	);
	camera.mode = Camera.PERSPECTIVE_CAMERA;
	camera.fov = CAMERA_FOV; // vertical FOV (Babylon's default fovMode)
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

	const setDepthRange = (w: number, h: number): void => {
		currentWidth = w;
		currentHeight = h;
		// PERSPECTIVE requires minZ > 0 — the negative near plane described above
		// is an orthographic-only trick and would clip everything here. Keep the
		// span tight around the model: perspective concentrates depth precision
		// near the camera, so pushing the near plane as far out as the geometry
		// allows is what keeps dense parallel beads from z-fighting.
		camera.minZ = Math.max(camera.radius * 0.01, camera.radius - MODEL_DEPTH_MARGIN);
		camera.maxZ = camera.radius + MODEL_DEPTH_MARGIN;
	};
	setDepthRange(width, height);

	// Keyboard navigation. Gated on the pointer being over the viewer so it
	// never hijacks keys typed elsewhere in the app, and it ignores modified
	// chords (Ctrl/Cmd/Alt) so browser shortcuts still work. WASD pans the
	// view across the bed, Q/E orbit CCW/CW, R/F tilt forward/reverse, T/G
	// zoom in/out (radius, same knob the wheel/pinch drive).
	let pointerOverCanvas = false;
	const onPointerEnter = (): void => { pointerOverCanvas = true; };
	const onPointerLeave = (): void => { pointerOverCanvas = false; };
	canvas.addEventListener("pointerenter", onPointerEnter);
	canvas.addEventListener("pointerleave", onPointerLeave);

	const ROTATE_STEP = 0.08; // radians per keypress
	const PAN_FRACTION = 0.06; // of the current view height per keypress
	const KEY_ZOOM_STEP = 1.12; // radius multiplier per keypress
	const handleKey = (event: KeyboardEvent): void => {
		if (!pointerOverCanvas || event.ctrlKey || event.metaKey || event.altKey) return;
		const size = 2 * camera.radius * Math.tan(CAMERA_FOV / 2); // current view height at the target (mm)
		const pan = size * PAN_FRACTION;
		// WASD pans across the BED plane, not the screen: flatten the camera's
		// heading onto the ground (Babylon XZ) so W/S move away/toward along
		// the bed and A/D move across it, regardless of how the view is tilted.
		const view = camera.target.subtract(camera.position);
		let fx = view.x, fz = view.z;
		let flen = Math.hypot(fx, fz);
		if (flen < 1e-4) { // near top-down: heading is vertical, use screen-up's ground projection
			const su = camera.getDirection(Vector3.Up());
			fx = su.x; fz = su.z; flen = Math.hypot(fx, fz) || 1;
		}
		fx /= flen; fz /= flen;
		const groundFwd = new Vector3(fx, 0, fz);
		const groundRight = new Vector3(fz, 0, -fx); // cross(worldUp, groundFwd)
		let handled = true;
		switch (event.key.toLowerCase()) {
			case "a": camera.target.addInPlace(groundRight.scale(-pan)); break;
			case "d": camera.target.addInPlace(groundRight.scale(pan)); break;
			case "w": camera.target.addInPlace(groundFwd.scale(pan)); break;
			case "s": camera.target.addInPlace(groundFwd.scale(-pan)); break;
			case "q": camera.alpha -= ROTATE_STEP; break; // CCW
			case "e": camera.alpha += ROTATE_STEP; break; // CW
			case "r": camera.beta += ROTATE_STEP; break; // forward tilt
			case "f": camera.beta -= ROTATE_STEP; break; // reverse tilt
			case "t": camera.radius = Math.max(camera.lowerRadiusLimit ?? 1e-3, camera.radius / KEY_ZOOM_STEP); break; // zoom in
			case "g": camera.radius = Math.min(camera.upperRadiusLimit ?? Infinity, camera.radius * KEY_ZOOM_STEP); break; // zoom out
			default: handled = false;
		}
		if (!handled) return;
		event.preventDefault();
		camera.beta = Math.max(0.01, Math.min(Math.PI - 0.01, camera.beta)); // keep off the poles (gimbal flip)
		setDepthRange(currentWidth, currentHeight);
		requestRender();
	};
	window.addEventListener("keydown", handleKey);

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

	// Bed plane at build height 0 — a world-anchored reference so
	// orbiting/panning reads as the CAMERA moving around a fixed scene, not
	// the model tumbling in empty space. Sized to the machine's actual XY bed
	// footprint, dropped a hair below 0 so it doesn't z-fight the first layer.
	// It's a flat plane facing the spotlight head-on, so it's EXCLUDED from
	// that light (it would otherwise blow out to bright blue) and lit only by
	// the flat ambient — a quiet dark reference, not a lit surface. There's no
	// projected shadow map: the shadows in the view are incidental, coming
	// from the spotlight's own directional shading of the real geometry (faces
	// toward the light bright, away from it dark), not an artificial cast.
	const bed = MeshBuilder.CreateGround("bed", { width: bedSize.x, height: bedSize.y }, scene);
	bed.position = new Vector3(bedCenter.x, -0.1, bedCenter.y);
	const bedMaterial = new StandardMaterial("bedMat", scene);
	bedMaterial.diffuseColor = new Color3(0x12 / 255, 0x1e / 255, 0x2a / 255);
	bedMaterial.specularColor = Color3.Black();
	bed.material = bedMaterial;
	spotLight.excludedMeshes.push(bed);

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

	// Unit CYLINDER (round cross-section, height/diameter 1 so the instance
	// matrix's columns are width / length / width directly — Babylon's cylinder
	// axis is +Y, which is the column writeBoxMatrix puts the segment direction
	// in, so no bake/rotate is needed).
	//
	// This was a flat box, chosen as cheaper (12 tris) and "closer to a real
	// flat-topped FDM bead". That reasoning is superseded: a box has four flat
	// faces and therefore no radial normals, so it cannot carry a specular
	// highlight along the bead — and that highlight is what makes SEAMS visible,
	// which is diagnostic information about the print, not decoration. The
	// reference viewer (@sindarius/gcodeviewer, studied per CLAUDE.md — never
	// copied) thin-instances a cylinder for exactly this reason; its geometry
	// architecture is otherwise the same as ours.
	//
	// TESSELLATION is the quality/cost knob: tris per instance ≈ 4·T − 4 with
	// caps (T=8 → 28, T=12 → 44) against the box's 12. Caps are kept because
	// each bead is extended half a width at both ends, so open ends could show
	// through at a run's extremities.
	const TUBE_TESSELLATION = 12;
	const tubeTemplate = MeshBuilder.CreateCylinder("tubeTemplate", {
		height: 1, diameter: 1, tessellation: TUBE_TESSELLATION,
	}, scene);
	tubeTemplate.setEnabled(false);
	tubeTemplate.isVisible = false;

	// Extruding geometry is MERGED into collinear runs (see mergeSegments.ts):
	// one box instance per run, far fewer than one per raw segment. These are
	// computed once at setGeometry (geometry is fixed) and never rebuilt —
	// only which runs are opaque vs ghost (by segStart) and their colors
	// change per tick. mergedSegStart is ascending, so any contiguous
	// original-segment range maps to a contiguous slice of merged instances.
	let mergedMatrices: Float32Array | null = null; // 16 floats per merged run, PRINT order
	let mergedSegStart: Uint32Array | null = null; // first original segment index of each run (split classification)
	let mergedColorSeg: Uint32Array | null = null; // original segment index each run samples its color from
	let runCount = 0;                              // number of merged runs

	// The ghost is a 50%-alpha preview of what hasn't printed yet, so it does not
	// need the opaque set's fidelity. It gets its OWN run table at a much looser
	// deviation bound (GHOST_TOLERANCE_MM) — roughly half the instances. This is
	// the largest win early in a print, when the ghost is most of the scene.
	// Seam note: the two tables' run boundaries no longer coincide, so opaque and
	// ghost can overlap/gap by at most one run at the print head (~1mm on a 200mm
	// model, sub-pixel at normal zoom) — far below the co-located-geometry scale
	// that causes z-fighting.
	let ghostForwardMatrices: Float32Array | null = null; // ghost table matrices in PRINT order (band path)
	let ghostForwardColors: Float32Array | null = null; // ghost table colours in PRINT order (band path)
	let ghostSegStart: Uint32Array | null = null;
	let ghostColorSeg: Uint32Array | null = null;
	let ghostRunCount = 0;

	// Build-once instance buffers. The whole toolpath is uploaded to the GPU a
	// single time; a live tick then only changes thinInstanceCount — how many
	// instances draw — never re-slices or re-uploads (the reference GCodeViewer's
	// speed comes from exactly this: build once, drive progress with a scalar).
	//   - opaque* : PRINT order, so the printed prefix [0, printed) is a count.
	//   - ghost*  : REVERSE print order, so the NOT-yet-printed suffix is ALSO a
	//     prefix ([0, total-printed)) — the two sets stay disjoint (no z-fight)
	//     and each is a single count, no offset needed.
	let ghostMatrices: Float32Array | null = null; // 16 floats per run, REVERSE order
	let opaqueColors: Float32Array | null = null;  // 4 floats per run, PRINT order (rebuilt only on colorMode change)
	let ghostColors: Float32Array | null = null;   // 4 floats per run, REVERSE order

	let opaqueMesh: Mesh | null = null;
	let ghostBeforeMesh: Mesh | null = null; // only used by the band (layer-focus) path
	let ghostAfterMesh: Mesh | null = null;
	let travelMesh: Mesh | null = null;

	// Which buffers the opaque/ghostAfter meshes currently hold, so a hot-path
	// tick can tell whether it may just set counts (already "prefix") or must
	// (re)upload the full/sliced buffers first (coming from "band"/"none").
	let splitConfig: "none" | "prefix" | "band" = "none";

	const onCameraChanged = (): void => {
		setDepthRange(currentWidth, currentHeight);
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

	/** One box transform from a gcode start point to an end point, written column-major into `out` at `offset`.
	 *
	 *  The box's local axes are built explicitly rather than via a
	 *  shortest-arc rotation: aligning only the length axis to the segment
	 *  direction leaves the roll about it undefined, which tilts the bead's
	 *  flat faces to a random diagonal. Here local Y = segment direction,
	 *  local X (width) = the HORIZONTAL perpendicular to it (in the bed
	 *  plane), and local Z = their cross product — so the bead sits flat, its
	 *  wide faces roughly parallel to the bed rather than canted. */
	const writeBoxMatrix = (
		out: Float32Array, offset: number,
		sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
		width: number, height: number,
	): void => {
		// gcode (x,y,z) -> Babylon (x, z, y): build height z becomes Babylon Y (up).
		const bsx = sx, bsy = sz, bsz = sy;
		const bex = ex, bey = ez, bez = ey;
		const mx = (bsx + bex) / 2, my = (bsy + bey) / 2, mz = (bsz + bez) / 2;
		let dx = bex - bsx, dy = bey - bsy, dz = bez - bsz;
		let length = Math.hypot(dx, dy, dz);
		if (length < 1e-6) { dx = 0; dy = 1; dz = 0; length = 1e-4; }
		else { dx /= length; dy /= length; dz /= length; }

		// right = normalize(cross(worldUp(0,1,0), dir)) = normalize((dz, 0, -dx))
		let rx = dz, ry = 0, rz = -dx;
		let rlen = Math.hypot(rx, ry, rz);
		if (rlen < 1e-6) { rx = 1; ry = 0; rz = 0; rlen = 1; } // near-vertical move: any horizontal width axis
		else { rx /= rlen; ry /= rlen; rz /= rlen; }
		// up = cross(right, dir). NOTE the argument order: cross(dir, right)
		// would give a LEFT-handed basis (negative determinant), which mirrors
		// the box and inverts its face winding — outward faces get backface-
		// culled, so only the inner side faces and end caps render (no top or
		// bottom). cross(right, dir) keeps the basis right-handed / winding
		// intact. (It happens to point "down", but the box is symmetric so
		// which perpendicular is +Z doesn't matter — only the handedness does.)
		const ux = ry * dz - rz * dy;
		const uy = rz * dx - rx * dz;
		const uz = rx * dy - ry * dx;

		// Beads span EXACTLY start→end. An earlier version extended each by half a
		// width at both ends to close the wedge-shaped void on the outside of a
		// turn; that was invisible on flat boxes but with a round, capped
		// cross-section every bead visibly protrudes past its segment — reading as
		// a chain of overflowing sausage ends rather than one continuous tube.
		// Overlap is the wrong tool for joining round beads.
		const drawLength = length;
		// ELLIPTICAL cross-section: `width` across the bead, `height` (the layer
		// height) vertically. A real FDM bead is ~0.4mm wide but only ~0.2mm tall;
		// scaling both perpendicular axes by width made round beads twice as tall
		// as they should be, which reads as fat sausages rather than extrusions.
		// The reference viewer composes exactly this (scale = length × layerHeight
		// × width) — studied per CLAUDE.md, never copied.
		out[offset] = rx * width; out[offset + 1] = ry * width; out[offset + 2] = rz * width; out[offset + 3] = 0;
		out[offset + 4] = dx * drawLength; out[offset + 5] = dy * drawLength; out[offset + 6] = dz * drawLength; out[offset + 7] = 0;
		out[offset + 8] = ux * height; out[offset + 9] = uy * height; out[offset + 10] = uz * height; out[offset + 11] = 0;
		out[offset + 12] = mx; out[offset + 13] = my; out[offset + 14] = mz; out[offset + 15] = 1;
	};

	/** Merge extruding segments into collinear runs and build one box matrix per run; store the run→segment maps for split classification and coloring. */
	const computeMergedGeometry = (positions: Float32Array, widths: Float32Array, extruding: Uint8Array, layerIndex: Uint16Array, heightOf: (seg: number) => number): void => {
		const runs = mergeExtrudingRuns(positions, widths, extruding, layerIndex);
		const count = runs.length;
		const matrices = new Float32Array(count * 16);
		const segStart = new Uint32Array(count);
		const colorSeg = new Uint32Array(count);
		for (let idx = 0; idx < count; idx++) {
			const r = runs[idx]!;
			const sb = r.start * 6;
			const eb = (r.end - 1) * 6;
			writeBoxMatrix(
				matrices, idx * 16,
				positions[sb]!, positions[sb + 1]!, positions[sb + 2]!,
				positions[eb + 3]!, positions[eb + 4]!, positions[eb + 5]!,
				widths[r.start]!, heightOf(r.start),
			);
			segStart[idx] = r.start;
			colorSeg[idx] = r.start;
		}
		mergedMatrices = matrices;
		mergedSegStart = segStart;
		mergedColorSeg = colorSeg;
		runCount = count;

		// Ghost: its own, coarser table.
		const gRuns = mergeExtrudingRuns(positions, widths, extruding, layerIndex, GHOST_TOLERANCE_MM);
		const gCount = gRuns.length;
		const gMatrices = new Float32Array(gCount * 16);
		const gSegStart = new Uint32Array(gCount);
		const gColorSeg = new Uint32Array(gCount);
		for (let idx = 0; idx < gCount; idx++) {
			const r = gRuns[idx]!;
			const sb = r.start * 6;
			const eb = (r.end - 1) * 6;
			writeBoxMatrix(
				gMatrices, idx * 16,
				positions[sb]!, positions[sb + 1]!, positions[sb + 2]!,
				positions[eb + 3]!, positions[eb + 4]!, positions[eb + 5]!,
				widths[r.start]!, heightOf(r.start),
			);
			gSegStart[idx] = r.start;
			gColorSeg[idx] = r.start;
		}
		ghostForwardMatrices = gMatrices;
		ghostSegStart = gSegStart;
		ghostColorSeg = gColorSeg;
		ghostRunCount = gCount;
		// The ghost draws its instances in REVERSE print order, so the
		// not-yet-printed suffix becomes a prefix drivable by thinInstanceCount
		// (see the buffer declarations above). Reverse the per-run matrix blocks.
		const rev = new Float32Array(gCount * 16);
		for (let r = 0; r < gCount; r++) rev.set(gMatrices.subarray((gCount - 1 - r) * 16, (gCount - 1 - r) * 16 + 16), r * 16);
		ghostMatrices = rev;
	};

	/** Per-segment box matrices for the NON-extruding (travel) moves only — travel isn't merged (it's hidden by default and low-count). */
	const computeTravelMatrices = (positions: Float32Array, widths: Float32Array, extruding: Uint8Array): Float32Array => {
		let n = 0;
		for (let i = 0; i < extruding.length; i++) if (extruding[i] !== 1) n++;
		const matrices = new Float32Array(n * 16);
		let o = 0;
		for (let i = 0; i < extruding.length; i++) {
			if (extruding[i] === 1) continue;
			const b = i * 6;
			writeBoxMatrix(matrices, o * 16, positions[b]!, positions[b + 1]!, positions[b + 2]!, positions[b + 3]!, positions[b + 4]!, positions[b + 5]!, widths[i]!, widths[i]!);
			o++;
		}
		return matrices;
	};

	/** Per-merged-run RGBA from the current hue (6 floats/segment, RGB duplicated — see hueColors.ts), sampled at each run's representative segment. */
	const extractMergedColors = (hue: Float32Array, colorSeg: Uint32Array): Float32Array => {
		const count = colorSeg.length;
		const colors = new Float32Array(count * 4);
		for (let idx = 0; idx < count; idx++) {
			const base = colorSeg[idx]! * 6;
			colors[idx * 4] = hue[base]!; colors[idx * 4 + 1] = hue[base + 1]!; colors[idx * 4 + 2] = hue[base + 2]!;
			colors[idx * 4 + 3] = 1;
		}
		return colors;
	};

	/** First merged-run index whose segStart >= value (mergedSegStart is ascending). */
	const lowerBoundRun = (segStart: Uint32Array, value: number): number => {
		let lo = 0, hi = segStart.length;
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (segStart[mid]! < value) lo = mid + 1; else hi = mid; }
		return lo;
	};

	/** Attaches thin-instance matrix/color buffers to a mesh (reusing `existing` in place), giving a fresh clone its own private geometry on first build. */
	const applyInstances = (existing: Mesh | null, outMatrices: Float32Array, outColors: Float32Array | null, material: StandardMaterial, name: string): Mesh => {
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
		// These full/sliced buffers are uploaded once per geometry/color change (or
		// per band re-slice), NOT per live tick — the hot path only changes
		// thinInstanceCount. staticBuffer=false because they still get rewritten on
		// those infrequent events (colorMode switch, reveal-mode switch, new file).
		mesh.thinInstanceSetBuffer("matrix", outMatrices, 16, false);
		if (outColors !== null) mesh.thinInstanceSetBuffer("color", outColors, 4, false);
		return mesh;
	};

	/** Builds/refills a mesh from the merged runs whose first segment falls in [rangeStart, rangeEnd).
	 *  Because mergedSegStart is ascending, that's a contiguous slice of merged instances — so a run
	 *  straddling the live-print boundary is classified whole (by its first segment) into one side. */
	const buildRunMesh = (
		existing: Mesh | null, rangeStart: number, rangeEnd: number,
		mergedColors: Float32Array, material: StandardMaterial, name: string,
		matrices: Float32Array | null = mergedMatrices, segStart: Uint32Array | null = mergedSegStart,
	): Mesh | null => {
		const mergedMatrices = matrices, mergedSegStart = segStart;
		if (mergedMatrices === null || mergedSegStart === null) return existing;
		const lo = lowerBoundRun(mergedSegStart, rangeStart);
		const hi = lowerBoundRun(mergedSegStart, rangeEnd);
		if (hi <= lo) {
			existing?.setEnabled(false);
			return existing;
		}
		// Contiguous slices → standalone copies (each mesh owns its buffer).
		const outMatrices = mergedMatrices.slice(lo * 16, hi * 16);
		const outColors = mergedColors.slice(lo * 4, hi * 4);
		return applyInstances(existing, outMatrices, outColors, material, name);
	};

	// --- Build-once split: opaque prefix / ghost suffix via thinInstanceCount ---
	// Sets how many of a build-once mesh's instances draw, or hides it at 0.
	const setMeshCount = (mesh: Mesh | null, count: number): void => {
		if (mesh === null) return;
		if (count <= 0) { mesh.setEnabled(false); return; }
		mesh.thinInstanceCount = count;
		mesh.setEnabled(true);
		mesh.isVisible = true;
	};

	// Uploads the persistent FULL buffers (all runs) onto the opaque (print
	// order) and ghostAfter (reverse order) meshes. Called only when geometry or
	// colors change, or when returning from the band path — never on a plain
	// live-position tick, which just moves the two counts (no upload).
	const loadFullBuffers = (): void => {
		if (mergedMatrices === null || ghostMatrices === null || opaqueColors === null || ghostColors === null) return;
		opaqueMesh = applyInstances(opaqueMesh, mergedMatrices, opaqueColors, opaqueMaterial, "opaque");
		ghostAfterMesh = applyInstances(ghostAfterMesh, ghostMatrices, ghostColors, ghostMaterial, "ghostAfter");
		ghostBeforeMesh?.setEnabled(false);
	};

	// Recomputes the full per-run color buffers (print + reverse order) from the
	// current hue. Called when the color MODE changes (infrequent), not per tick.
	const loadColors = (hue: Float32Array): void => {
		if (mergedColorSeg === null || ghostColorSeg === null) return;
		opaqueColors = extractMergedColors(hue, mergedColorSeg);
		// Ghost colours come from the ghost table (different run count/boundaries).
		const gFwd = extractMergedColors(hue, ghostColorSeg);
		const n = ghostRunCount;
		const rev = new Float32Array(n * 4);
		for (let r = 0; r < n; r++) {
			const s = (n - 1 - r) * 4;
			rev[r * 4] = gFwd[s]!; rev[r * 4 + 1] = gFwd[s + 1]!; rev[r * 4 + 2] = gFwd[s + 2]!; rev[r * 4 + 3] = gFwd[s + 3]!;
		}
		ghostColors = rev;
		ghostForwardColors = gFwd;
	};

	// Applies the current opaque/ghost split. Two paths:
	//   PREFIX (opaqueRange.start === 0: progressive, static, first-layer focus)
	//     — the fast live path. The printed opaque prefix and the not-yet-printed
	//     ghost suffix are each a single instance count on the build-once meshes,
	//     so a tick just sets those two counts — no slicing, no GPU upload.
	//   BAND (opaqueRange.start > 0: layer-focus above layer 0) — the cold path.
	//     A middle band can't be a prefix, so opaque + both ghost pieces are
	//     re-sliced/uploaded. Only on manual mode use / a layer change.
	const applySplit = (opaqueRange: SegmentRange, ghostRanges: GhostRanges): void => {
		if (mergedMatrices === null || mergedSegStart === null || opaqueColors === null) return;

		if (opaqueRange.start === 0) {
			if (splitConfig !== "prefix") {
				// The meshes may currently hold band slices — reload the full buffers.
				loadFullBuffers();
				splitConfig = "prefix";
			}
			const opaqueCount = lowerBoundRun(mergedSegStart, opaqueRange.end); // runs [0, opaqueCount)
			// Ghost is in reverse order, so its first (total - opaqueCount) instances
			// are the not-yet-printed suffix. Hidden ghost → after range empty → 0.
			const gs = ghostSegStart ?? mergedSegStart;
			const ghostCount = lowerBoundRun(gs, ghostRanges.after.end) - lowerBoundRun(gs, ghostRanges.after.start);
			setMeshCount(opaqueMesh, opaqueCount);
			setMeshCount(ghostAfterMesh, Math.max(0, ghostCount));
		} else {
			// Band path: re-slice opaque band + ghost before/after (forward order).
			opaqueMesh = buildRunMesh(opaqueMesh, opaqueRange.start, opaqueRange.end, opaqueColors, opaqueMaterial, "opaque");
			ghostBeforeMesh = buildRunMesh(ghostBeforeMesh, ghostRanges.before.start, ghostRanges.before.end, ghostForwardColors ?? opaqueColors, ghostMaterial, "ghostBefore", ghostForwardMatrices, ghostSegStart);
			ghostAfterMesh = buildRunMesh(ghostAfterMesh, ghostRanges.after.start, ghostRanges.after.end, ghostForwardColors ?? opaqueColors, ghostMaterial, "ghostAfter", ghostForwardMatrices, ghostSegStart);
			splitConfig = "band";
		}

		requestRender();
		// A freshly built mesh's material shader compiles asynchronously; on-demand
		// rendering can fire the render above before that finishes, and Babylon
		// silently skips a not-yet-ready mesh with nothing to prompt a retry.
		// executeWhenReady re-renders once every pending resource (incl. shader
		// compile) is ready — guarantees the real first paint per new mesh.
		scene.executeWhenReady(requestRender);
	};

	return {
		setGeometry(positions, hue, widths, extruding, layerIndex, layerHeights, opaqueRange, ghostRanges) {
			// New geometry → fresh meshes (each needs its own private geometry via
			// makeGeometryUnique) and a forced full-buffer (re)load on next split.
			disposeAll();
			splitConfig = "none";
			// Fall back to the bead width if a layer height is missing/degenerate.
			const heightOf = (seg: number): number => {
				const h = layerHeights[layerIndex[seg]!];
				return h !== undefined && h > 1e-4 ? h : widths[seg]!;
			};
			computeMergedGeometry(positions, widths, extruding, layerIndex, heightOf);
			loadColors(hue);

			disposeTravel();
			const travelMatrices = computeTravelMatrices(positions, widths, extruding);
			travelMesh = travelMatrices.length > 0 ? applyInstances(null, travelMatrices, null, travelMaterial, "travel") : null;
			if (travelMesh !== null) travelMesh.setEnabled(false);

			applySplit(opaqueRange, ghostRanges);
		},
		updateColors(hue, opaqueRange, ghostRanges) {
			// Color MODE changed: rebuild the color buffers and force a full reload
			// (splitConfig "none" makes applySplit re-upload the new colors).
			loadColors(hue);
			splitConfig = "none";
			applySplit(opaqueRange, ghostRanges);
		},
		updatePosition(opaqueRange, ghostRanges) {
			// Live-position / reveal / ghost-mode tick — the hot path. In the prefix
			// case this is just two thinInstanceCount assignments, no upload.
			applySplit(opaqueRange, ghostRanges);
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
			setDepthRange(w, h);
			requestRender();
		},
		destroy() {
			cancelAnimationFrame(pendingFrame);
			camera.onViewMatrixChangedObservable.removeCallback(onCameraChanged);
			window.removeEventListener("keydown", handleKey);
			canvas.removeEventListener("pointerenter", onPointerEnter);
			canvas.removeEventListener("pointerleave", onPointerLeave);
			disposeAll();
			disposeTravel();
			tubeTemplate.dispose();
			opaqueMaterial.dispose();
			ghostMaterial.dispose();
			travelMaterial.dispose();
			marker.dispose();
			markerMaterial.dispose();
			scene.dispose(); // disposes the bed, its material, and the lights
			engine.dispose();
		},
	};
}
