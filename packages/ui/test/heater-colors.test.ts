import { test } from "node:test";
import assert from "node:assert/strict";
import { BED_COLOR, CHAMBER_COLOR, TOOL_COLORS } from "../src/om/heaterSeries.ts";

/**
 * The chart's real requirement is not "each series has a colour" — it is "no
 * operator can mistake one line for another". That is a perceptual property, so
 * it is asserted perceptually here rather than left to whoever next edits the
 * hex values.
 *
 * Regression this pins: the bed's gold and a tool's gold once measured ΔE 9.4
 * apart and were indistinguishable on screen.
 */

const srgbToLinear = (c: number): number =>
	c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** CIELAB (D65). CIE76 ΔE is coarse but ample for "are these two lines telling apart". */
function toLab(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLinear(v / 255)) as [number, number, number];
	let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const t = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
	[x, y, z] = [t(x), t(y), t(z)];
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: string, b: string): number {
	const [l1, a1, b1] = toLab(a);
	const [l2, a2, b2] = toLab(b);
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Below this, two lines on a dark ground stop being reliably separable. */
const MIN_SEPARATION = 25;

test("every pair of heater colours is perceptually distinct", () => {
	const palette: [string, string][] = [
		["Bed", BED_COLOR],
		["Chamber", CHAMBER_COLOR],
		...TOOL_COLORS.map((c, i): [string, string] => [`tool${i}`, c]),
	];
	for (let i = 0; i < palette.length; i++) {
		for (let j = i + 1; j < palette.length; j++) {
			const [nameA, colorA] = palette[i]!;
			const [nameB, colorB] = palette[j]!;
			const separation = deltaE(colorA, colorB);
			assert.ok(
				separation >= MIN_SEPARATION,
				`${nameA} (${colorA}) and ${nameB} (${colorB}) are only ΔE ${separation.toFixed(1)} apart — need ${MIN_SEPARATION}`,
			);
		}
	}
});

test("the measurement can fail — the old bed/tool gold pair is caught", () => {
	// Red-check: proves MIN_SEPARATION is doing work rather than passing vacuously.
	assert.ok(deltaE("#c9a227", "#e0b84a") < MIN_SEPARATION);
});

test("no tool colour duplicates another", () => {
	assert.equal(new Set(TOOL_COLORS).size, TOOL_COLORS.length);
});
