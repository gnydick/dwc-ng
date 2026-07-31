/**
 * Where a wheel event over a large inner scroller should go.
 *
 * The console and the text editors are tall scrollers that fill most of their
 * card, so putting the pointer almost anywhere over one meant the wheel drove
 * THAT box and the page underneath would not move. Navigating past a console
 * became a hunt for a few pixels of card that were not the console.
 *
 * So the inner box only takes the wheel at its left and right EDGES. Over the
 * middle the page scrolls, which is what the pointer being over a big passive
 * readout almost always means. The strips are invisible by request — no cue,
 * no border; they are muscle memory, not a control.
 *
 * The geometry is pure and lives here so it can be tested without a DOM, and
 * so there is exactly one definition of "the middle" for every scroller in the
 * app rather than a copy per card.
 */

/** Share of the width, centred, that scrolls the PAGE rather than the box. */
export const CENTER_FRACTION = 0.7;

/**
 * A strip narrower than this is not a target anyone can hit on purpose. On a
 * narrow card the 15% share collapses to a few pixels, so the strip takes this
 * instead and the centre gives up the difference.
 */
export const EDGE_MIN_PX = 24;

/**
 * ...but the centre must survive. Without this ceiling a card narrower than
 * 2 x EDGE_MIN_PX would be all strip and the page could never be scrolled from
 * over it — the original complaint, inverted.
 */
export const EDGE_MAX_FRACTION = 0.3;

/** Width of ONE edge strip, in px, for a scroller of the given width. */
export function edgeWidth(width: number): number {
	if (!(width > 0)) return 0;
	const share = width * (1 - CENTER_FRACTION) / 2;
	// Rounded: a strip is a number of pixels, and 1 - 0.7 is 0.30000000000000004
	// in binary floating point, so the unrounded result is 60.00000000000001 for
	// a 400px box. Sub-pixel precision buys nothing here and makes the value
	// awkward to state exactly, in a test or in a bug report.
	return Math.round(Math.min(Math.max(share, EDGE_MIN_PX), width * EDGE_MAX_FRACTION));
}

/**
 * True when the pointer is over the centre band — the page should scroll.
 * `offsetX` is measured from the scroller's left edge.
 */
export function overCenter(width: number, offsetX: number): boolean {
	const edge = edgeWidth(width);
	return offsetX >= edge && offsetX <= width - edge;
}

/**
 * Only LARGE scrollers are governed. A dropdown, a 72px reply box or a short
 * popover list is small enough to aim around already, and stealing its wheel
 * would make it unusable — the rule exists for boxes big enough to be in the
 * way, not for every `overflow: auto` in the stylesheet.
 */
export const MIN_GOVERNED_H = 100;
export const MIN_GOVERNED_W = 180;

export function isGoverned(width: number, height: number): boolean {
	return width >= MIN_GOVERNED_W && height >= MIN_GOVERNED_H;
}

/** Wheel deltas arrive in lines on some devices; this is the px-per-line. */
export const LINE_HEIGHT_PX = 16;

export function deltaPixels(delta: number, deltaMode: number): number {
	// 0 = pixel, 1 = line, 2 = page. Page is rare; treat it as a screenful.
	if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
	if (deltaMode === 2) return delta * 400;
	return delta;
}

/** Can this element actually scroll vertically right now? */
function scrollsVertically(el: HTMLElement): boolean {
	if (el.scrollHeight <= el.clientHeight + 1) return false;
	const overflow = getComputedStyle(el).overflowY;
	return overflow === "auto" || overflow === "scroll";
}

/**
 * The nearest scrollable box between `from` and the page scroller, exclusive of
 * the page scroller itself — that one IS the page and is never redirected.
 */
function innerScroller(from: EventTarget | null, page: HTMLElement): HTMLElement | null {
	let el = from instanceof Element ? from : null;
	while (el !== null && el !== page) {
		if (el instanceof HTMLElement && scrollsVertically(el)) return el;
		el = el.parentElement;
	}
	return null;
}

/**
 * One delegated, capture-phase listener for the whole app — not a directive
 * each card remembers to apply. A card added tomorrow with a tall console in it
 * is governed without knowing this file exists, which is the only version of
 * this that stays true.
 *
 * Non-passive because it must be able to preventDefault; capture so it runs
 * before the scroller's own default action is committed.
 *
 * Returns its own teardown.
 */
export function installEdgeScroll(getPage: () => HTMLElement | null): () => void {
	// The strips are invisible until you are over the box, and CSS cannot find
	// them on its own: "governed" means scrollHeight exceeds clientHeight, which
	// no selector can ask. So the same pass that decides the rule also marks the
	// element, and the stylesheet only has to draw what it is told. One
	// definition of which boxes are governed, and one of how wide a strip is.
	let marked: HTMLElement | null = null;
	const unmark = (): void => {
		if (marked === null) return;
		marked.removeAttribute("data-edge-scroll");
		marked.style.removeProperty("--edge-w");
		marked = null;
	};
	const onPointerOver = (e: PointerEvent): void => {
		const page = getPage();
		if (page === null) return;
		const inner = innerScroller(e.target, page);
		if (inner === marked) return;
		unmark();
		if (inner === null) return;
		const rect = inner.getBoundingClientRect();
		if (!isGoverned(rect.width, rect.height)) return;
		inner.style.setProperty("--edge-w", `${edgeWidth(rect.width)}px`);
		inner.setAttribute("data-edge-scroll", "");
		marked = inner;
	};

	const onWheel = (e: WheelEvent): void => {
		const page = getPage();
		if (page === null) return;
		const inner = innerScroller(e.target, page);
		if (inner === null) return;

		const rect = inner.getBoundingClientRect();
		if (!isGoverned(rect.width, rect.height)) return;
		if (!overCenter(rect.width, e.clientX - rect.left)) return;

		// Over the middle: the page moves, the box does not.
		e.preventDefault();
		page.scrollTop += deltaPixels(e.deltaY, e.deltaMode);
		// Horizontal intent is not what this rule is about, and preventDefault
		// would have swallowed it — hand it back to the box it was aimed at.
		if (e.deltaX !== 0) inner.scrollLeft += deltaPixels(e.deltaX, e.deltaMode);
	};

	document.addEventListener("wheel", onWheel, { capture: true, passive: false });
	// pointerover, not pointerenter: one delegated listener sees every box,
	// and it fires on the move BETWEEN two scrollers as well as into one.
	document.addEventListener("pointerover", onPointerOver, { capture: true, passive: true });
	return () => {
		document.removeEventListener("wheel", onWheel, { capture: true });
		document.removeEventListener("pointerover", onPointerOver, { capture: true });
		unmark();
	};
}
