/**
 * SpeedSlider's freeze/follow state machine, as a module the test rig can
 * drive (node, no DOM): the scale centre, the in-flight target, and the
 * gesture wiring that connects them to the shared range-gesture machine.
 * Extracted from SpeedSlider.tsx in the #194 inc 2 fix round so the
 * net-zero-gesture regression test exercises the PRODUCTION wiring rather
 * than a test-side copy — SpeedSlider imports this and adds only DOM and
 * send/ack presentation on top.
 *
 * The states, and who owns the scale:
 *
 * - FOLLOW (centre null, target null): the scale derives from the live
 *   machine reading; the handle tracks every poll.
 * - GESTURE (centre set at grab, dragging): the scale is frozen at the
 *   value the gesture started from — it derives from the very speed the
 *   gesture is changing, so a live scale would rescale under the finger.
 * - IN FLIGHT (centre = target = the sent value): the command is out; the
 *   scale is already the one the machine will imply once it catches up,
 *   so the hand-off on a later poll is invisible.
 *
 * A gesture that completes WITHOUT a send (net-zero drag, changeless grab
 * — the shared machine sends only when the final value differs from the
 * gesture's own anchor) claims no target, so its grab-time centre must be
 * dropped when the gesture ends or the scale stays frozen at that moment's
 * speed FOREVER — silently, because the frozen scale equals the live one
 * until the machine next moves. That is the regression this module's test
 * pins (speed-hold.test.ts).
 */
import { createEffect, createSignal, onCleanup } from "solid-js";
import { createRangeGesture } from "./rangeGesture.ts";
import { speedScale, type SpeedScale } from "./speedScale.ts";

export interface SpeedHold {
	/** The value on the handle (dragged, in flight, or the live reading). */
	value: () => number;
	setValue: (pct: number) => void;
	dragging: () => boolean;
	/** The frozen scale centre; null = follow the machine. */
	centre: () => number | null;
	/** The sent value the machine has not yet reported; null = none. */
	target: () => number | null;
	/** The scale on screen — frozen centre first, live reading otherwise. */
	scale: () => SpeedScale;
	/** A send claims the commit: the sent value IS the value, centre and
	 *  target, before the dragging flag drops (order is load-bearing — see
	 *  SpeedSlider's release-order note). */
	claim: (pct: number) => void;
	/** A failed send hands everything back to the machine. */
	release: () => void;
	/** The shared gesture machine, wired: forward the DOM events to these. */
	gesture: ReturnType<typeof createRangeGesture>;
}

export function createSpeedHold(opts: {
	/** Live machine reading — a reactive accessor. */
	currentPct: () => number;
	/** Fire the command with the gesture's final value. */
	send: (pct: number) => void;
}): SpeedHold {
	const [dragging, setDragging] = createSignal(false);
	const [value, setValue] = createSignal(opts.currentPct());
	const [centre, setCentre] = createSignal<number | null>(null);
	const [target, setTarget] = createSignal<number | null>(null);

	const scale = (): SpeedScale => speedScale(centre() ?? opts.currentPct());

	// Follow the machine, except while the operator is holding the handle or
	// a commanded change is still in flight — either would clobber the value
	// the operator is looking at with a reading we know to be stale.
	createEffect(() => {
		const live = opts.currentPct();
		if (!dragging() && target() === null) setValue(live);
	});

	// The machine caught up: hand back to it. No jump, because the scale it
	// derives from `live` is the scale already on screen.
	createEffect(() => {
		const live = opts.currentPct();
		const want = target();
		if (want !== null && Math.round(live) === Math.round(want)) {
			setTarget(null);
			setCentre(null);
		}
	});

	const gesture = createRangeGesture({
		// Freeze the scale for the duration of the gesture — a live scale
		// derives from the speed the gesture is changing and would rescale
		// under the finger (or under a held arrow key).
		onOpen: () => setCentre(opts.currentPct()),
		onActive: active => {
			setDragging(active);
			// A gesture that completed WITHOUT a send claimed no target, so
			// the centre set at grab time must go with it — or one changeless
			// grab freezes the scale forever (#194 inc 2 review, R1). Correct
			// because the machine invokes onSend BEFORE onActive(false)
			// (range-gesture.test.ts pins the ordering), so on a sending
			// gesture the claim has set the target by the time we look.
			if (!active && target() === null) setCentre(null);
		},
		onSend: opts.send,
	});
	onCleanup(gesture.dispose);

	return {
		value,
		setValue,
		dragging,
		centre,
		target,
		scale,
		claim: pct => {
			setValue(pct);
			setCentre(pct);
			setTarget(pct);
		},
		release: () => {
			setTarget(null);
			setCentre(null);
			setValue(opts.currentPct());
		},
		gesture,
	};
}
