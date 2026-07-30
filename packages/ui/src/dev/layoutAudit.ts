/**
 * The layout oracle's arithmetic — deliberately free of the DOM so it can be
 * unit-tested in node:test, which has no layout engine.
 *
 * The DOM half lives in LayoutAuditPanel.tsx. The split exists because the two
 * halves fail differently: this file's bugs are logic bugs a unit test catches,
 * the panel's bugs are geometry bugs only a real browser can see.
 */

/** One measurement: the card was SIZE along an axis and reported REPORTED. */
export interface AxisProbe {
	size: number;
	reported: number;
}

export interface AxisVerdict {
	axis: "row" | "col";
	stable: boolean;
	reported: number[];
	spread: number;
}

/**
 * Sub-pixel tolerance. Row units are fractional at tight density pitches
 * (--row-unit is 2.8px at 0.40), so a ceil() over a fractional divisor can
 * legitimately differ by one between probes. Two or more is a real dependency.
 */
export const AXIS_TOLERANCE = 1;

/**
 * INVARIANT A: a card's reported minimum along an axis must be independent of
 * its own used size along that axis.
 *
 * CSS Sizing 3 defines min-content as the size the box would have "if its
 * containing block was zero-sized in that axis" — the actual container is not
 * an input by construction. A minimum that moves with the card means the
 * measurement is reading post-layout geometry, which is a different quantity;
 * Chromium calls the resulting ratchet "hysteresis".
 */
export function judgeAxis(axis: "row" | "col", probes: readonly AxisProbe[]): AxisVerdict {
	const reported = probes.map(p => p.reported);
	// One probe cannot show dependence, and zero certainly cannot. Returning
	// "stable" is honest: nothing was tested. The panel reports the probe count
	// alongside, so an untested axis is visible rather than silently passing.
	if (reported.length < 2) return { axis, stable: true, reported, spread: 0 };
	const spread = Math.max(...reported) - Math.min(...reported);
	return { axis, stable: spread <= AXIS_TOLERANCE, reported, spread };
}

/** A descendant's position relative to the card body, at one container size. */
export interface DriftSample {
	id: string;
	main: number;
	cross: number;
}

/**
 * INVARIANT B: no descendant changes position when the container resizes along
 * the OTHER axis.
 *
 * NOT a discovered property — there is no prior art naming it and no
 * component-level analogue to Cumulative Layout Shift, which is page-level and
 * time-windowed. It is this project's positional-stability requirement,
 * expressed as something checkable. It is FALSE BY CONSTRUCTION for a slot
 * containing wrapping text, so cards that legitimately reflow must be excluded
 * by name rather than by fudging the comparison.
 */
export function judgeDrift(
	a: readonly DriftSample[],
	b: readonly DriftSample[],
): { stable: boolean; moved: string[] } {
	// A differing count means children appeared or vanished with size, which is
	// a stronger violation than movement — report it rather than zipping the
	// shorter list and silently ignoring the tail.
	if (a.length !== b.length) return { stable: false, moved: ["<child count changed>"] };
	const moved: string[] = [];
	for (let i = 0; i < a.length; i++) {
		const before = a[i]!;
		const after = b[i]!;
		if (Math.abs(before.main - after.main) > AXIS_TOLERANCE
			|| Math.abs(before.cross - after.cross) > AXIS_TOLERANCE) {
			moved.push(before.id);
		}
	}
	return { stable: moved.length === 0, moved };
}
