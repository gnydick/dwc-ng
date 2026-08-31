import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import { createSpeedHold, type SpeedHold } from "../src/control/speedHold.ts";

/**
 * SpeedSlider's freeze/follow machine (speedHold.ts — the module the
 * component actually wires; see its header for why it exists as a module).
 *
 * The regression pinned here (#194 inc 2 review): a gesture that completes
 * WITHOUT a send — the shared machine's own net-zero rule — claims no
 * target, and the first cut never cleared the centre set at grab time, so
 * one changeless grab froze the scale at that moment's speed FOREVER. The
 * freeze is silent (frozen equals live until the machine next moves), which
 * is why it needs a test that moves the machine afterwards.
 */

function withHold(run: (h: {
	hold: SpeedHold;
	setLive: (pct: number) => void;
	sends: number[];
}) => void): void {
	// Set up inside the root, but RUN the steps after it returns: Solid
	// queues effects until the root body completes, so driving signals from
	// within the body would never let the follow/catch-up effects react.
	let hold!: SpeedHold;
	let setLive!: (pct: number) => void;
	const sends: number[] = [];
	const dispose = createRoot(d => {
		const [live, set] = createSignal(100);
		setLive = set;
		// The send claims the commit synchronously, exactly as the
		// component's send() does — inside onSend, so BEFORE onActive(false).
		hold = createSpeedHold({ currentPct: live, send: pct => { sends.push(pct); hold.claim(pct); } });
		return d;
	});
	try {
		run({ hold, setLive, sends });
	} finally {
		dispose();
	}
}

test("a changeless grab clears the centre, and an external speed change re-anchors the scale", () => {
	withHold(({ hold, setLive, sends }) => {
		assert.equal(hold.scale().max, 200, "follow: scale derives from the live 100%");

		// Grab the handle and let go without moving it: the shared machine
		// sends nothing (net-zero), so nothing claims a target.
		hold.gesture.down(hold.value());
		assert.equal(hold.centre(), 100, "frozen for the duration of the grab");
		hold.gesture.up();
		assert.deepEqual(sends, [], "a changeless grab stays off the wire");
		assert.equal(hold.centre(), null, "…and hands the scale straight back to the machine");

		// The machine moves on its own (a macro, another client): the scale
		// must re-anchor. With the centre leaked, it would sit at 200 forever.
		setLive(150);
		assert.equal(hold.scale().max, 300, "the scale follows the machine again");
		assert.equal(hold.value(), 150, "so does the handle");
	});
});

test("a net-zero drag (returned to its anchor) also unfreezes the scale", () => {
	withHold(({ hold, setLive, sends }) => {
		hold.gesture.down(100);
		hold.setValue(140);
		hold.gesture.change(100, 140);
		hold.setValue(100);
		hold.gesture.change(140, 100);
		hold.gesture.up();
		assert.deepEqual(sends, [], "no net change, no request");
		assert.equal(hold.centre(), null);
		setLive(80);
		assert.equal(hold.scale().max, 160, "scale re-anchors to the machine");
	});
});

test("a gesture that DOES send keeps the centre until the machine catches up", () => {
	withHold(({ hold, setLive, sends }) => {
		hold.gesture.down(100);
		hold.setValue(150);
		hold.gesture.change(100, 150);
		hold.gesture.up();
		assert.deepEqual(sends, [150], "one send, at release, of the final value");
		// The send claimed the commit inside onSend, which the machine
		// invokes BEFORE onActive(false) — range-gesture.test.ts pins that
		// ordering — so a target existed by the time the drag flag dropped
		// and the completion did NOT clear the in-flight centre.
		assert.equal(hold.centre(), 150, "in flight: frozen at the sent value");
		setLive(120);
		assert.equal(hold.centre(), 150, "an unrelated reading does not unfreeze it");
		setLive(150);
		assert.equal(hold.centre(), null, "the machine caught up: follow again");
		assert.equal(hold.target(), null);
		setLive(90);
		assert.equal(hold.scale().max, 180, "and the scale is the machine's once more");
	});
});

test("release (a failed send) hands value, centre and target back to the machine", () => {
	withHold(({ hold, setLive }) => {
		hold.claim(180);
		assert.equal(hold.centre(), 180);
		hold.release();
		assert.equal(hold.centre(), null);
		assert.equal(hold.target(), null);
		assert.equal(hold.value(), 100, "back to what the machine actually has");
		setLive(110);
		assert.equal(hold.value(), 110, "and following it again");
	});
});
