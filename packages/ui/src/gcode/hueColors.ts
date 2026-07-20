/**
 * Per-segment RGB from the active color mode — fed to scene.ts as each
 * instanced tube segment's per-instance color, independent of reveal-mode
 * (see renderModes.ts), which only decides opaque-vs-ghost-vs-hidden
 * per-mesh assignment now, not a per-vertex alpha channel.
 *
 * All color constants here (and FEATURE_TYPE_COLORS) are written as
 * ordinary sRGB display values — 0-1 versions of the 0-255 RGB you'd see
 * in a color picker or, for the feature-type palette, in OrcaSlicer's own
 * source. But Three.js's standard materials (MeshStandardMaterial, used
 * for the toolpath) expect vertex/instance colors already in LINEAR space
 * — it's part of Three's own color management, re-encoding to sRGB only
 * at final output. Feeding it sRGB values directly double-encodes them,
 * which is what "colors are too pastel" actually was: not the values, but
 * skipping this conversion. writeSegment below is the single choke point
 * every color source (feature-type, speed, layer-time) passes through, so
 * it's the one place this needs to happen.
 *
 * Speed/layer-time both normalize linearly across a [min, max] domain —
 * computeSpeedRange/computeLayerTimeRange expose the file's own full data
 * range so GcodeViewer.tsx's range sliders have real bounds to start from;
 * passing a NARROWER range (below) stretches the same SLOW_COLOR->FAST_COLOR
 * gradient across less of the data, which is what actually spreads the
 * colors out further when most segments cluster in a sub-range of the
 * naturally-occurring min/max.
 */

import type { ParsedToolpath } from "./parseGcode.ts";
import { FEATURE_TYPE_COLORS } from "./featureTypes.ts";

export type ColorMode = "speed" | "feature-type" | "layer-time";

const SLOW_COLOR: readonly [number, number, number] = [0.05, 0.35, 0.98]; // vivid blue
const FAST_COLOR: readonly [number, number, number] = [0.98, 0.15, 0.05]; // vivid red
const NO_DATA_COLOR: readonly [number, number, number] = [0.5, 0.5, 0.5]; // neutral gray

function lerp3(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
	t: number,
): readonly [number, number, number] {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The standard sRGB EOTF (same formula THREE.Color.convertSRGBToLinear() uses). */
export function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function colorModeAvailable(toolpath: ParsedToolpath, mode: ColorMode): boolean {
	if (mode === "layer-time") {
		for (const t of toolpath.layerTimeMinutes) if (!Number.isNaN(t)) return true;
		return false;
	}
	return true;
}

/** The file's actual full speed range (mm/min) — always defined, every segment has a speed. */
export function computeSpeedRange(toolpath: ParsedToolpath): [number, number] {
	let min = Infinity, max = -Infinity;
	for (const s of toolpath.speed) { min = Math.min(min, s); max = Math.max(max, s); }
	return [min, max];
}

/** The file's actual full layer-time range (minutes), or null if the file has no M73/LAYER_CHANGE data at all. */
export function computeLayerTimeRange(toolpath: ParsedToolpath): [number, number] | null {
	let min = Infinity, max = -Infinity;
	for (const t of toolpath.layerTimeMinutes) if (!Number.isNaN(t)) { min = Math.min(min, t); max = Math.max(max, t); }
	return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
}

/**
 * @param range Overrides the domain the SLOW_COLOR->FAST_COLOR gradient
 *   spans, for "speed"/"layer-time" modes only (ignored otherwise). Values
 *   outside [range.min, range.max] clamp to the nearest end color rather
 *   than extrapolating. Omit to use the file's own full min/max (the
 *   previous, only behavior).
 */
export function computeHueColors(toolpath: ParsedToolpath, mode: ColorMode, range?: readonly [number, number]): Float32Array {
	const { segmentCount } = toolpath;
	const colors = new Float32Array(segmentCount * 6);

	const writeSegment = (i: number, rgb: readonly [number, number, number]): void => {
		const base = i * 6;
		const r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
		colors[base] = r; colors[base + 1] = g; colors[base + 2] = b;
		colors[base + 3] = r; colors[base + 4] = g; colors[base + 5] = b;
	};

	const clampedT = (value: number, min: number, max: number): number => {
		if (max <= min) return 0;
		return Math.min(1, Math.max(0, (value - min) / (max - min)));
	};

	if (mode === "feature-type") {
		for (let i = 0; i < segmentCount; i++) {
			writeSegment(i, FEATURE_TYPE_COLORS[toolpath.featureType[i]!] ?? NO_DATA_COLOR);
		}
		return colors;
	}

	if (mode === "layer-time") {
		const [min, max] = range ?? computeLayerTimeRange(toolpath) ?? [0, 0];
		const hasData = colorModeAvailable(toolpath, "layer-time");
		for (let i = 0; i < segmentCount; i++) {
			const layerTime = toolpath.layerTimeMinutes[toolpath.layerIndex[i]!]!;
			if (!hasData || Number.isNaN(layerTime)) { writeSegment(i, NO_DATA_COLOR); continue; }
			writeSegment(i, lerp3(SLOW_COLOR, FAST_COLOR, clampedT(layerTime, min, max)));
		}
		return colors;
	}

	// speed
	const [min, max] = range ?? computeSpeedRange(toolpath);
	for (let i = 0; i < segmentCount; i++) {
		writeSegment(i, lerp3(SLOW_COLOR, FAST_COLOR, clampedT(toolpath.speed[i]!, min, max)));
	}
	return colors;
}
