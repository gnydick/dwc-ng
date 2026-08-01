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
 * @invariant card-floor-independent-of-size
 * @rung 4  static analysis, run on demand — the audit panel measures every
 *          registry card in a real browser and ranks violations first. It is a
 *          measurement rather than a test: nothing in CI runs it, and nothing
 *          stops a card shipping with a moving floor
 * @why a floor that moves with the card is layout hysteresis: dragging a card
 *      smaller ratchets its minimum down, so its own contents decide how small
 *      it can get and the size the operator set does not survive a resize
 * @debt two gaps, and the second is the larger. (1) The sweep is manual, so
 *       promote by running it headless over the registry in CI — the CDP
 *       driver already exists. (2) Card Lab's state pills do not change the
 *       bench, so ten cards are measured EMPTY and their real content is never
 *       audited; that is catalogued separately in DEBT.md.
 *
 * CSS Sizing 3 defines min-content as the size the box would have "if its
 * containing block was zero-sized in that axis" — the actual container is not
 * an input by construction. A minimum that moves with the card means the
 * measurement is reading post-layout geometry, which is a different quantity;
 * Chromium calls the resulting ratchet "hysteresis".
 *
 * WHAT THIS DOES NOT ESTABLISH, and the panel must not imply that it does:
 * judgeAxis is handed only the sequence of REPORTED values. No ground truth is
 * in scope, by signature — so a floor that is uniformly and grossly WRONG is
 * the cleanest possible pass. A passing verdict says the measurement is
 * self-consistent, never that the number is right. That is why the passing
 * label below is a description and not "ok", and why judgeFloor exists.
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

/**
 * The words the panel prints for a PASSED check — one declaration site, so the
 * UI cannot quietly go back to saying "ok".
 *
 * "ok" was the whole defect: a card whose entire body had been dragged out of
 * its own floor showed a green `ok` in a column headed `A · row`, and the first
 * operator to run the sweep would have read that as "this layout is sound". A
 * passed check earns a sentence about what was actually established, nothing
 * more.
 *
 * A·col is the sharp case. contentColSpan obtains its number by setting the
 * body to `width: min-content` and reading it back, and min-content is BY
 * DEFINITION the size at a zero-sized containing block — the card's own width
 * is already not an input. Probing three widths and finding the same answer is
 * therefore a tautology, not a check, and the label says so rather than letting
 * three identical numbers pose as evidence.
 */
export const AXIS_PASS_LABEL: Readonly<Record<"row" | "col", string>> = {
	row: "unchanged by height",
	col: "unchanged by width",
};

/** Appended to A·col only: its pass is a property of the measurement, not of the card. */
export const AXIS_COL_TAUTOLOGY = "by construction — min-content cannot depend on width";

/** Column headings, phrased as the question each column answers. */
export const AUDIT_HEADINGS = {
	floor: "Body in floor",
	axisRow: "Row min vs height",
	axisCol: "Col min vs width",
	drift: "Child drift",
} as const;

/**
 * A body worth this many rows or fewer is worth NOTHING. Two rows is 8px at the
 * default pitch and 5.6px at the tightest — under one line of text either way,
 * so no card can legitimately claim its whole content fits there. Slack, not
 * generosity: it absorbs the ceil() at the two conversions being subtracted.
 */
export const EMPTY_BODY_ROWS = 2;

export interface FloorVerdict {
	/** The card's reported row floor, in row units. */
	rowStop: number;
	/** The floor the SAME card reports with its body's content contributing
	 *  nothing: header, gaps, padding, card chrome, gutter. */
	chromeStop: number;
	/** rowStop - chromeStop: what the body's own content is worth. */
	bodyStop: number;
	/** False when the body is worth ~nothing — the real defect. */
	bodyCounted: boolean;
}

/**
 * THE CHECK INVARIANT A CANNOT MAKE: does the card's floor contain its body?
 *
 * Invariant A asks whether the reported minimum MOVES. A floor that is
 * constantly reported and constantly wrong is perfectly stable, so it passes —
 * and on 2026-07-30 it passed on all 41 cards while four of them (temperatures,
 * gcode-viewer, job-files, system-files) sat at the header-only floor and could
 * be dragged over their entire contents. Every one of them was a card whose
 * slack-absorbing child declares `min-height: 0`: contentRowSpan substitutes
 * that declared floor for the child's rendered height (deliberately — it is
 * what removes the self-reference A tests for), so the child contributes
 * exactly 0 and the card's whole body vanishes from its own minimum.
 *
 * Subtracting the two floors is what makes that visible, and it needs no
 * declared ground truth: chromeStop is the SAME arithmetic run over the same
 * card with the body's content taken out, so the difference is exactly the rows
 * the content is worth. Zero means the card's floor is its header and nothing
 * else.
 */
export function judgeFloor(rowStop: number, chromeStop: number): FloorVerdict {
	const bodyStop = rowStop - chromeStop;
	return { rowStop, chromeStop, bodyStop, bodyCounted: bodyStop > EMPTY_BODY_ROWS };
}

/**
 * What judgeDrift puts in `moved` when the CHILD COUNT itself differed between
 * probes — a structural violation, not a moved child id.
 *
 * Exported because it shares an array with real child ids, so the only way to
 * tell it apart is by value. It used to be a literal here and a second literal
 * in the panel, kept equal by a comment; one import makes that unbreakable.
 */
export const CHILD_COUNT_CHANGED = "<child count changed>";

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
 * @invariant no-child-drift-on-resize
 * @rung 4  static analysis, run on demand — the same audit sweep, comparing
 *          descendant positions before and after a cross-axis resize
 * @why this is the project's positional-stability requirement, not a
 *      discovered property: a live-updating machine UI whose contents shift
 *      under the pointer is one you cannot operate confidently. There is no
 *      component-level analogue to Cumulative Layout Shift to borrow
 * @debt violations are reported by POSITION, so the panel gives counts rather
 *       than naming the culprit element — a reader still has to hunt. Promote
 *       by reporting a stable path to the drifting node, and by running the
 *       sweep headless in CI as with card-floor-independent-of-size.
 *
 * FALSE BY CONSTRUCTION for a slot containing wrapping text, so cards that
 * legitimately reflow are excluded BY NAME rather than by fudging the
 * comparison — an exclusion list is debt, and is filed as such.
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
	if (a.length !== b.length) return { stable: false, moved: [CHILD_COUNT_CHANGED] };
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
