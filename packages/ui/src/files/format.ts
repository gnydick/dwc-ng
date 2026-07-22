/** Display formatters for file listings, kept out of the component so they're
 *  unit-testable (node's type-stripping can't load JSX). */

/**
 * RRF's file timestamp ("2026-07-21T14:30:00") to "2026-07-21 14:30". Sliced
 * rather than parsed through `new Date()` on purpose: the board reports LOCAL
 * time with no zone, so constructing a Date would shift it by the viewer's
 * offset. A date-only value (no time part) just yields the date.
 */
export function formatModified(date: string | undefined): string {
	if (!date) return "";
	return date.slice(0, 16).replace("T", " ");
}
