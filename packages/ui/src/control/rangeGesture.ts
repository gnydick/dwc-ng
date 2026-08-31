/**
 * The range-input gesture machine — THE route from a house `<input
 * type="range">`'s events to a G-code send. Both consumers (SpeedSlider and
 * ControlList's data-defined slider) drive this one machine; neither wires
 * its own keydown/keyup/change handlers.
 *
 * @invariant one-send-per-gesture
 * @rung 6  choke-point + unrepresentable trigger — a keyboard event cannot
 *          cause a send because keyboard events are not events of this
 *          machine at all: only VALUE CHANGES open a gesture (plus the
 *          pointer bracket), so the old defects — one send per auto-repeat
 *          arrow step, a send on a bare Shift keyup — have no encoding.
 *          range-gesture.test.ts drives the reducer with the exact
 *          sequences that used to misfire and counts the send effects.
 * @why RRF's embedded server tolerates very few requests. A held arrow key
 *      fires `input`+`change` on EVERY auto-repeat step (~20/s); wiring
 *      send to those events (increment 1 did, gated only on a flag that a
 *      keydown re-armed) bursts rr_gcode at the board. One send per
 *      completed value-change gesture is the review-set invariant
 * @debt the choke-point is voluntary at the component seam: nothing stops a
 *       slider from wiring onChange straight to sendCode again, and no test
 *       pins the component→machine wiring, so that regression would pass
 *       the suite (the reducer tests only prove the machine itself). Promote
 *       by making this machine the only party able to construct the
 *       sendable command — a branded send token minted per completed
 *       gesture — so a bypass send has nothing to hand the connector
 *
 * The gesture model:
 *
 * - POINTER: pointerdown opens (anchor = value at grab), `input` events
 *   update `latest`, pointerup/pointercancel completes. No timer — the
 *   finger says when the gesture is over.
 * - KEYBOARD (and any other non-pointer value source, e.g. AT): the first
 *   value change while idle opens (anchor = the value BEFORE it), each
 *   further change re-arms the settle window, and the window closing —
 *   or blur — completes. Arming requires an actual change by construction.
 * - Grabbing the handle mid-keyboard-gesture MERGES: the settle timer is
 *   cancelled, the anchor survives, and the drag's release completes one
 *   combined gesture — still one send.
 *
 * Completion sends the final value ONLY if it differs from the anchor: a
 * gesture whose net change is zero (arrow up then down; a drag returned to
 * its start; a changeless grab) is not a value-change gesture and stays
 * off the wire. The comparison is against the GESTURE'S OWN start value,
 * never a remembered "last sent" — the board is the authority and can move
 * between gestures, so any longer-lived latch would go stale and suppress
 * a needed send.
 */

/**
 * How long after the last keyboard-driven change the gesture settles.
 * Auto-repeat steps arrive ~30–50 ms apart and deliberate repeated presses
 * ~150–300 ms, so 500 ms cleanly brackets both as one gesture. Erring long
 * is the cheap direction: too short re-creates the burst this machine
 * exists to prevent; too long only delays a single send.
 */
export const KEY_SETTLE_MS = 500;

export type GestureMode = "idle" | "pointer" | "keys";

export interface GestureState {
	readonly mode: GestureMode;
	/** The value when the gesture opened — the "no net change" reference. */
	readonly anchor: number;
	/** The most recent value the gesture has seen. */
	readonly latest: number;
}

export const GESTURE_IDLE: GestureState = { mode: "idle", anchor: 0, latest: 0 };

export type GestureEvent =
	| { kind: "down"; value: number }
	| { kind: "up" }
	| { kind: "change"; prev: number; next: number }
	| { kind: "settle" }
	| { kind: "blur" };

export interface GestureEffects {
	/** The one completed-gesture send, or null. */
	send: number | null;
	/** What the settle timer should do: (re)arm, cancel, or nothing. */
	timer: "arm" | "cancel" | "none";
}

const completed = (state: GestureState): GestureEffects => ({
	send: state.latest !== state.anchor ? state.latest : null,
	timer: "none",
});

/** Pure and total: every (state, event) pair has a defined next state. */
export function stepGesture(state: GestureState, event: GestureEvent): [GestureState, GestureEffects] {
	switch (event.kind) {
		case "down":
			switch (state.mode) {
				case "idle":
					return [{ mode: "pointer", anchor: event.value, latest: event.value }, { send: null, timer: "none" }];
				case "keys":
					// Merge: the keyboard gesture continues as a pointer one.
					return [{ ...state, mode: "pointer" }, { send: null, timer: "cancel" }];
				case "pointer":
					return [state, { send: null, timer: "none" }];
			}
			break;
		case "change":
			switch (state.mode) {
				case "idle":
					return [{ mode: "keys", anchor: event.prev, latest: event.next }, { send: null, timer: "arm" }];
				case "keys":
					return [{ ...state, latest: event.next }, { send: null, timer: "arm" }];
				case "pointer":
					return [{ ...state, latest: event.next }, { send: null, timer: "none" }];
			}
			break;
		case "up":
			if (state.mode === "pointer") return [GESTURE_IDLE, completed(state)];
			return [state, { send: null, timer: "none" }];
		case "settle":
			if (state.mode === "keys") return [GESTURE_IDLE, completed(state)];
			// A stale timer the wrapper failed to cancel must stay inert.
			return [state, { send: null, timer: "none" }];
		case "blur":
			if (state.mode === "keys") return [GESTURE_IDLE, { ...completed(state), timer: "cancel" }];
			// Mid-drag blur: pointerup/pointercancel still completes; nothing here.
			return [state, { send: null, timer: "none" }];
	}
}

export interface RangeGestureHooks {
	/** THE send — called at most once per completed value-change gesture. */
	onSend: (value: number) => void;
	/** A gesture opened (freeze scales, etc.). */
	onOpen?: () => void;
	/**
	 * Mirrors whether a gesture is open. On completion `onSend` is invoked
	 * BEFORE `onActive(false)`: a consumer whose follow-the-machine effect
	 * keys on the active flag can mark its in-flight target inside onSend
	 * and not have the dragged value clobbered by a stale poll reading when
	 * the flag drops (SpeedSlider's release-order bug, kept fixed here).
	 */
	onActive?: (active: boolean) => void;
}

export interface RangeGesture {
	/** Wire to onPointerDown, with the CURRENT staged value. */
	down: (value: number) => void;
	/** Wire to onPointerUp AND onPointerCancel. */
	up: () => void;
	/** Wire to onInput: the staged value before and after this event. */
	change: (prev: number, next: number) => void;
	/** Wire to onBlur. */
	blur: () => void;
	/** Clear the settle timer (call from onCleanup). */
	dispose: () => void;
}

/**
 * The stateful wrapper: owns the reducer state and the settle timer.
 * Deliberately NOT wired to keydown/keyup/change DOM events — `input`
 * covers every value change on a range input, which is what makes the
 * spurious-keyup send unrepresentable rather than merely guarded.
 */
export function createRangeGesture(hooks: RangeGestureHooks): RangeGesture {
	let state: GestureState = GESTURE_IDLE;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const dispatch = (event: GestureEvent): void => {
		const wasOpen = state.mode !== "idle";
		const [next, fx] = stepGesture(state, event);
		state = next;
		if (fx.timer === "cancel") clearTimeout(timer);
		if (fx.timer === "arm") {
			clearTimeout(timer);
			timer = setTimeout(() => dispatch({ kind: "settle" }), KEY_SETTLE_MS);
		}
		const isOpen = state.mode !== "idle";
		if (!wasOpen && isOpen) {
			hooks.onOpen?.();
			hooks.onActive?.(true);
		}
		// Send before deactivating — see RangeGestureHooks.onActive.
		if (fx.send !== null) hooks.onSend(fx.send);
		if (wasOpen && !isOpen) hooks.onActive?.(false);
	};

	return {
		down: value => dispatch({ kind: "down", value }),
		up: () => dispatch({ kind: "up" }),
		change: (prev, next) => dispatch({ kind: "change", prev, next }),
		blur: () => dispatch({ kind: "blur" }),
		dispose: () => clearTimeout(timer),
	};
}
