/**
 * Palette tokens, resolved to concrete strings for uPlot.
 *
 * uPlot hands its colours to a canvas context, which cannot resolve CSS custom
 * properties — so a chart cannot write `var(--silk-dim)` and the two charts
 * carried literal copies instead. Copies drift, and these did: both still held
 * #8FA3B8 for --silk-dim and #5AA9E6 for --accent-blue, so after the ground
 * moved from navy to anodize the charts were the last surface still painted for
 * the old palette, and one of them referenced a token that no longer exists.
 *
 * Reading the token instead means a chart follows whatever ground is active,
 * including the dev palette lab's, with no parallel list to keep in step.
 *
 * Resolved per plot BUILD rather than per frame. The charts already rebuild
 * when the series shape changes, and switching ground is a reload — so there is
 * nothing to invalidate, and no per-sample cost.
 *
 * The fallbacks are the shipped values. They exist for a document that has not
 * applied its stylesheet yet, never as a second opinion about the palette: if
 * one is ever reached in a real browser, the token was misspelled.
 */

/** A token's computed value, or `fallback` if the document has nothing to say. */
export function token(name: string, fallback: string): string {
	if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return fallback;
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value === "" ? fallback : value;
}

/**
 * The same token at a given alpha, as `rgba(...)`.
 *
 * Expanded here rather than handed to canvas as `color-mix(...)`: canvas colour
 * parsing lags the CSS colour spec, and a string it fails to parse is a
 * silently invisible series rather than an error. rgba() has always worked.
 *
 * A non-hex token (a ground could legitimately hold `rgb()` or a named colour)
 * is passed through unchanged, which loses the alpha but never the colour —
 * the failure mode is "too opaque", not "gone".
 */
export function tokenAlpha(name: string, alpha: number, fallback: string): string {
	const colour = token(name, fallback);
	const hex = /^#([0-9a-f]{6})$/i.exec(colour);
	if (hex === null) return colour;
	const n = parseInt(hex[1]!, 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
