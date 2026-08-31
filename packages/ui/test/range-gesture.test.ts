import { test } from "node:test";
import assert from "node:assert/strict";
import {
	GESTURE_IDLE,
	KEY_SETTLE_MS,
	createRangeGesture,
	stepGesture,
	type GestureEvent,
	type GestureState,
} from "../src/control/rangeGesture.ts";

/**
 * The invariant under test (review of GIT_194 increment 1, finding 1/2):
 * ONE send per completed value-change gesture, on every modality. The old
 * wiring armed on any keydown and sent on every keyup/change, so a held
 * arrow key fired one rr_gcode per auto-repeat step — a burst of requests
 * at the embedded server this architecture exists to protect — and a
 * lone Shift keyup sent with no gesture at all.
 *
 * These tests drive the pure reducer with synthetic event sequences and
 * COUNT the send effects. A regression to per-step sending fails the
 * burst test; a regression to keyup-sends fails the no-change tests.
 */

function run(events: GestureEvent[], from: GestureState = GESTURE_IDLE): { sends: number[]; state: GestureState; timers: string[] } {
	const sends: number[] = [];
	const timers: string[] = [];
	let state = from;
	for (const event of events) {
		const [next, fx] = stepGesture(state, event);
		state = next;
		if (fx.send !== null) sends.push(fx.send);
		timers.push(fx.timer);
	}
	return { sends, state, timers };
}

test("a held arrow key is ONE send: a burst of changes then settle sends only the last value", () => {
	const burst: GestureEvent[] = [];
	for (let v = 100; v < 120; v++) burst.push({ kind: "change", prev: v, next: v + 1 });
	const r = run([...burst, { kind: "settle" }]);
	assert.deepEqual(r.sends, [120], "twenty auto-repeat steps must produce exactly one send, of the final value");
	assert.equal(r.state.mode, "idle");
});

test("every keyboard-driven change re-arms the settle window; pointer changes never arm it", () => {
	const keys = run([
		{ kind: "change", prev: 0, next: 1 },
		{ kind: "change", prev: 1, next: 2 },
	]);
	assert.deepEqual(keys.timers, ["arm", "arm"], "each keyboard step restarts the settle window");
	const pointer = run([
		{ kind: "down", value: 0 },
		{ kind: "change", prev: 0, next: 5 },
	]);
	assert.deepEqual(pointer.timers, ["none", "none"], "a pointer gesture completes on up, not on a timer");
});

test("no value change, no send: bare up/settle/blur and a changeless press are all silent", () => {
	assert.deepEqual(run([{ kind: "up" }]).sends, [], "a stray pointerup sends nothing");
	assert.deepEqual(run([{ kind: "settle" }]).sends, [], "a stale timer sends nothing");
	assert.deepEqual(run([{ kind: "blur" }]).sends, [], "blur outside a gesture sends nothing");
	// The old defect's shape: grab + release with no movement (or a Shift
	// keyup) used to send. Arming now REQUIRES a value change.
	assert.deepEqual(run([{ kind: "down", value: 50 }, { kind: "up" }]).sends, []);
});

test("a pointer drag is one send, at release, of the final value", () => {
	const r = run([
		{ kind: "down", value: 100 },
		{ kind: "change", prev: 100, next: 105 },
		{ kind: "change", prev: 105, next: 110 },
		{ kind: "up" },
	]);
	assert.deepEqual(r.sends, [110]);
	assert.equal(r.state.mode, "idle");
});

test("a gesture that returns to its anchor sends nothing — no net change, no request", () => {
	const drag = run([
		{ kind: "down", value: 100 },
		{ kind: "change", prev: 100, next: 120 },
		{ kind: "change", prev: 120, next: 100 },
		{ kind: "up" },
	]);
	assert.deepEqual(drag.sends, [], "the handle ended where it started");
	const keys = run([
		{ kind: "change", prev: 100, next: 105 },
		{ kind: "change", prev: 105, next: 100 },
		{ kind: "settle" },
	]);
	assert.deepEqual(keys.sends, [], "arrow up then down is not a value change");
});

test("grabbing the handle mid-keyboard-gesture merges into ONE gesture and cancels the timer", () => {
	const r = run([
		{ kind: "change", prev: 100, next: 105 }, // keyboard opens, arms
		{ kind: "down", value: 105 },             // grab: merge, cancel the timer
		{ kind: "change", prev: 105, next: 110 },
		{ kind: "up" },
	]);
	assert.deepEqual(r.sends, [110], "the merged gesture sends once, at release");
	assert.equal(r.timers[1], "cancel", "the pending settle must not fire under the drag");
});

test("blur commits an open keyboard gesture immediately", () => {
	const r = run([
		{ kind: "change", prev: 100, next: 102 },
		{ kind: "blur" },
	]);
	assert.deepEqual(r.sends, [102]);
	assert.deepEqual(r.timers, ["arm", "cancel"]);
	assert.equal(r.state.mode, "idle");
});

test("the tab-tap: a track click (down, jump, up) is one send of the jumped value", () => {
	const r = run([
		{ kind: "down", value: 100 },
		{ kind: "change", prev: 100, next: 150 },
		{ kind: "up" },
	]);
	assert.deepEqual(r.sends, [150]);
});

test("wrapper: keyboard changes settle into one onSend, and onSend fires BEFORE onActive(false)", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const calls: string[] = [];
	const g = createRangeGesture({
		onOpen: () => calls.push("open"),
		onActive: active => calls.push(`active:${active}`),
		onSend: value => calls.push(`send:${value}`),
	});
	g.change(100, 101);
	g.change(101, 102);
	t.mock.timers.tick(KEY_SETTLE_MS - 1);
	assert.deepEqual(calls, ["open", "active:true"], "nothing sends before the settle window closes");
	t.mock.timers.tick(1);
	// Ordering is load-bearing: SpeedSlider marks its in-flight target in
	// onSend; if the active flag dropped first, its follow-the-machine effect
	// would clobber the dragged value with a stale poll reading.
	assert.deepEqual(calls, ["open", "active:true", "send:102", "active:false"]);
	g.dispose();
});

test("wrapper: a re-armed window restarts from the LAST change", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const sends: number[] = [];
	const g = createRangeGesture({ onSend: value => sends.push(value) });
	g.change(0, 1);
	t.mock.timers.tick(KEY_SETTLE_MS - 1);
	g.change(1, 2); // re-arms — the old window must not fire
	t.mock.timers.tick(KEY_SETTLE_MS - 1);
	assert.deepEqual(sends, [], "the restarted window is still open");
	t.mock.timers.tick(1);
	assert.deepEqual(sends, [2]);
	g.dispose();
});
