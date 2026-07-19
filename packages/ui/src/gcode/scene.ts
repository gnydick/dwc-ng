/**
 * Three.js wiring for the G-code toolpath. Imported dynamically (see
 * GcodeViewer.tsx) so the whole Three.js bundle stays out of the initial
 * load — it only ships once Activity's G-code card actually mounts, same
 * lazy-load pattern as src/editor/setup.ts for CodeMirror.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface SceneHandle {
	/** (Re)builds the mesh from scratch — called once per parsed file. */
	setGeometry(positions: Float32Array, colors: Float32Array): void;
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

	let mesh: THREE.LineSegments | null = null;
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
		(mesh.material as THREE.Material).dispose();
		mesh = null;
	};

	return {
		setGeometry(positions, colors) {
			disposeMesh();
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
			const material = new THREE.LineBasicMaterial({ vertexColors: true });
			mesh = new THREE.LineSegments(geometry, material);
			scene.add(mesh);
		},
		updateColors(colors) {
			if (mesh === null) return;
			mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
			renderer.dispose();
		},
	};
}
