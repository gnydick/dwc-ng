/**
 * Perceptual distance between two colours, and the floor below which two
 * chart lines stop being reliably separable on the dark ground.
 *
 * This lived inside test/heater-colors.test.ts, where it enforced the shipped
 * palette. It moved here the moment heater colours became user-pickable: the
 * picker's collision warning and the palette test MUST measure with the same
 * arithmetic, or the UI could bless a pair CI rejects (and vice versa). One
 * definition, both call sites.
 *
 * CIE76 ΔE over CIELAB (D65). Coarse by modern standards — it under-reports
 * differences in saturated blues — but ample for "can an operator tell these
 * two lines apart", and cheap enough to run on every keystroke of a picker.
 */

const srgbToLinear = (c: number): number =>
	c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** #rgb or #rrggbb, case-insensitive. The only shape the pickers can emit. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True for a string a CSS colour slot can accept from untrusted storage. */
export function isHexColor(value: unknown): value is string {
	return typeof value === "string" && HEX.test(value);
}

/** #abc → #aabbcc. Any already-6-digit value passes through unchanged. */
export function expandHex(hex: string): string {
	if (hex.length !== 4) return hex;
	const [, r, g, b] = hex as unknown as [string, string, string, string];
	return `#${r}${r}${g}${g}${b}${b}`;
}

/** CIELAB (D65) for a hex colour. Throws on a non-hex input by construction —
 *  callers gate on isHexColor(), which is the only way a value reaches here. */
export function toLab(hex: string): [number, number, number] {
	const n = parseInt(expandHex(hex).slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
		.map(v => srgbToLinear(v / 255)) as [number, number, number];
	let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
	let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
	const t = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
	[x, y, z] = [t(x), t(y), t(z)];
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * WCAG 2 relative luminance and contrast ratio. 21 is black on white; the
 * floor for non-text graphics such as a chart line is 3:1, for text 4.5:1.
 */
export function relativeLuminance(hex: string): number {
	const n = parseInt(expandHex(hex).slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => srgbToLinear(v / 255)) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** CIE76 ΔE. 0 is identical; the JND is around 2.3. */
export function deltaE(a: string, b: string): number {
	const [l1, a1, b1] = toLab(a);
	const [l2, a2, b2] = toLab(b);
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Below this, two lines on a dark ground stop being reliably separable.
 *
 * The shipped palette is built to clear it with room to spare (every pair is
 * ≥ 29 apart). A user's own pick is WARNED about at this threshold, never
 * blocked — the guarantee is about the defaults we ship, and an operator who
 * wants two similar colours is allowed to have them.
 */
export const MIN_SEPARATION = 25;

/**
 * The nearest other colour, or null when nothing is within the floor.
 * `others` is label → colour so the warning can name what it collided with.
 */
export function nearestCollision(
	candidate: string,
	others: ReadonlyArray<readonly [string, string]>,
): { label: string; separation: number } | null {
	let worst: { label: string; separation: number } | null = null;
	for (const [label, color] of others) {
		if (!isHexColor(color)) continue;
		const separation = deltaE(candidate, color);
		if (separation >= MIN_SEPARATION) continue;
		if (worst === null || separation < worst.separation) worst = { label, separation };
	}
	return worst;
}
