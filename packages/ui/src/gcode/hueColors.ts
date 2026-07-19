/**
 * Per-segment RGB from the active color mode. Independent of reveal-mode
 * alpha (see renderModes.ts) — GcodeViewer.tsx combines both into the
 * final RGBA fed to the scene via renderModes.ts's combineRGBA.
 */

import type { ParsedToolpath } from "./parseGcode.ts";
import { FEATURE_TYPE_COLORS } from "./featureTypes.ts";

export type ColorMode = "speed" | "feature-type" | "layer-time";

const SLOW_COLOR: readonly [number, number, number] = [0.25, 0.4, 0.85]; // blue
const FAST_COLOR: readonly [number, number, number] = [0.85, 0.3, 0.25]; // red
const NO_DATA_COLOR: readonly [number, number, number] = [0.5, 0.5, 0.5]; // neutral gray

function lerp3(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
	t: number,
): readonly [number, number, number] {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function colorModeAvailable(toolpath: ParsedToolpath, mode: ColorMode): boolean {
	if (mode === "layer-time") {
		for (const t of toolpath.layerTimeMinutes) if (!Number.isNaN(t)) return true;
		return false;
	}
	return true;
}

export function computeHueColors(toolpath: ParsedToolpath, mode: ColorMode): Float32Array {
	const { segmentCount } = toolpath;
	const colors = new Float32Array(segmentCount * 6);

	const writeSegment = (i: number, rgb: readonly [number, number, number]): void => {
		const base = i * 6;
		colors[base] = rgb[0]; colors[base + 1] = rgb[1]; colors[base + 2] = rgb[2];
		colors[base + 3] = rgb[0]; colors[base + 4] = rgb[1]; colors[base + 5] = rgb[2];
	};

	if (mode === "feature-type") {
		for (let i = 0; i < segmentCount; i++) {
			writeSegment(i, FEATURE_TYPE_COLORS[toolpath.featureType[i]!] ?? NO_DATA_COLOR);
		}
		return colors;
	}

	if (mode === "layer-time") {
		let min = Infinity, max = -Infinity;
		for (const t of toolpath.layerTimeMinutes) if (!Number.isNaN(t)) { min = Math.min(min, t); max = Math.max(max, t); }
		const hasData = Number.isFinite(min) && Number.isFinite(max);
		for (let i = 0; i < segmentCount; i++) {
			const layerTime = toolpath.layerTimeMinutes[toolpath.layerIndex[i]!]!;
			if (!hasData || Number.isNaN(layerTime)) { writeSegment(i, NO_DATA_COLOR); continue; }
			const t = max > min ? (layerTime - min) / (max - min) : 0;
			writeSegment(i, lerp3(SLOW_COLOR, FAST_COLOR, t));
		}
		return colors;
	}

	// speed
	let min = Infinity, max = -Infinity;
	for (const s of toolpath.speed) { min = Math.min(min, s); max = Math.max(max, s); }
	for (let i = 0; i < segmentCount; i++) {
		const s = toolpath.speed[i]!;
		const t = max > min ? (s - min) / (max - min) : 0;
		writeSegment(i, lerp3(SLOW_COLOR, FAST_COLOR, t));
	}
	return colors;
}
