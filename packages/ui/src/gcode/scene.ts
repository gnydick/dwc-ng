/**
 * Three.js wiring for the G-code toolpath. Imported dynamically (see
 * GcodeViewer.tsx) so the whole Three.js bundle stays out of the initial
 * load — it only ships once Activity's G-code card actually mounts, same
 * lazy-load pattern as src/editor/setup.ts for CodeMirror.
 *
 * Uses the forked LineSegments2/LineSegmentsGeometry/LineMaterial (see
 * ./lineMaterial/) instead of stock THREE.LineSegments — stock Three.js
 * supports neither real per-vertex alpha nor per-segment width, both
 * required here (see docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "./lineMaterial/LineSegments2.ts";
import { LineSegmentsGeometry } from "./lineMaterial/LineSegmentsGeometry.ts";
import { LineMaterial } from "./lineMaterial/LineMaterial.ts";

export interface SceneHandle {
	/** (Re)builds the mesh from scratch — called once per parsed file. */
	setGeometry(positions: Float32Array, colors: Float32Array, widths: Float32Array): void;
	/** Rewrites only the color attribute — called on every live position tick. */
	updateColors(colors: Float32Array): void;
	resize(width: number, height: number): void;
	destroy(): void;
}

export function createScene(canvas: HTMLCanvasElement, width: number, height: number): SceneHandle {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setSize(width, height, false);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0a1420);

	const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
	camera.position.set(100, 100, 150);
	camera.up.set(0, 0, 1); // gcode's Z is "up" for a build plate, unlike Three's default Y-up

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;

	// One shared material across file loads — vertexColors/worldUnits/
	// linewidth never change per-load, only the per-segment geometry
	// attributes (color, width) do, via a fresh LineSegmentsGeometry each
	// time. LineSegments2's own onBeforeRender keeps the material's
	// resolution uniform in sync with the renderer's viewport on every
	// frame automatically — no manual wiring needed beyond
	// renderer.setSize() in resize() below.
	const material = new LineMaterial({
		vertexColors: true,
		transparent: true,
		// Translucent (not-yet-printed) segments must never block opaque
		// ones drawn behind them: with the default depthWrite:true, a
		// translucent fragment still writes a full depth value, so the
		// depth test rejects — entirely discards, not just dims — any
		// later-drawn opaque segment that's farther from the camera at
		// that pixel. depthWrite:false keeps depthTest respecting real
		// scene depth while letting every segment's own alpha (not an
		// earlier translucent segment's depth) decide what's visible.
		depthWrite: false,
		worldUnits: true,
		linewidth: 1, // neutral multiplier — real mm width comes from the per-segment instanceWidthScale attribute
	});

	let mesh: LineSegments2 | null = null;
	let raf = 0;
	const animate = (): void => {
		controls.update();
		renderer.render(scene, camera);
		raf = requestAnimationFrame(animate);
	};
	raf = requestAnimationFrame(animate);

	const disposeMesh = (): void => {
		if (mesh === null) return;
		scene.remove(mesh);
		mesh.geometry.dispose();
		mesh = null;
	};

	return {
		setGeometry(positions, colors, widths) {
			disposeMesh();
			const geometry = new LineSegmentsGeometry();
			geometry.setPositions(positions);
			geometry.setColors(colors);
			geometry.setWidths(widths);
			mesh = new LineSegments2(geometry, material);
			scene.add(mesh);
		},
		updateColors(colors) {
			if (mesh === null) return;
			(mesh.geometry as LineSegmentsGeometry).setColors(colors);
		},
		resize(w, h) {
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		},
		destroy() {
			cancelAnimationFrame(raf);
			controls.dispose();
			disposeMesh();
			material.dispose();
			renderer.dispose();
		},
	};
}
