import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderPump, SETTLE_FRAMES } from "../src/gcode/renderPump.ts";

/** Deterministic stand-in for requestAnimationFrame: the test decides when frames run. */
function fakeScheduler() {
	let nextHandle = 1;
	const queued = new Map<number, () => void>();
	return {
		scheduler: {
			request(cb: () => void): number {
				const handle = nextHandle++;
				queued.set(handle, cb);
				return handle;
			},
			cancel(handle: number): void {
				queued.delete(handle);
			},
		},
		get pending(): number {
			return queued.size;
		},
		/** Runs every currently-queued callback (frames they queue in turn run on the NEXT flush). */
		flush(): void {
			const due = [...queued.values()];
			queued.clear();
			for (const cb of due) cb();
		},
		/** Runs up to `n` successive frames, stopping early once nothing is queued. Returns frames actually run. */
		flushFrames(n: number): number {
			let ran = 0;
			for (let i = 0; i < n && queued.size > 0; i++) {
				ran++;
				this.flush();
			}
			return ran;
		},
	};
}

test("a fresh pump schedules nothing until asked", () => {
	const fake = fakeScheduler();
	let renders = 0;
	createRenderPump(() => renders++, fake.scheduler);
	assert.equal(fake.pending, 0);
	assert.equal(renders, 0);
});

test("request() draws exactly one frame and then goes idle", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	pump.request();
	assert.equal(fake.pending, 1, "one frame scheduled");
	fake.flush();
	assert.equal(renders, 1);
	assert.equal(fake.pending, 0, "a one-shot request must not keep the loop alive");
});

test("repeated request() before the frame runs coalesces into a single frame", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	pump.request();
	pump.request();
	pump.request();
	assert.equal(fake.pending, 1, "at most one frame may ever be in flight");
	fake.flush();
	assert.equal(renders, 1);
});

// The bug this module exists to prevent: Babylon's pointer/wheel/touch handlers only
// ACCUMULATE pixel deltas (Cameras/Inputs/arcRotateCameraPointersInput.js); the camera
// is moved by _checkInputs(), which runs only inside scene.render(). One frame per input
// event is not enough — inertia keeps decaying for ~0.5-0.8s of wall clock after the last
// event, and that motion only happens on frames we actually schedule.
test("interact() keeps drawing after the input event, without further input", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	pump.interact();
	fake.flush();
	assert.equal(renders, 1);
	assert.equal(fake.pending, 1, "input must keep the loop alive for the inertia tail");

	fake.flush();
	assert.equal(renders, 2, "still drawing with no new input");
});

test("the settle tail terminates on its own — the pump can never spin forever", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	pump.interact();
	const ran = fake.flushFrames(SETTLE_FRAMES * 3);
	assert.equal(ran, SETTLE_FRAMES, `tail runs exactly SETTLE_FRAMES (${SETTLE_FRAMES}) frames`);
	assert.equal(fake.pending, 0, "pump must return to idle — zero cost when nobody is interacting");
	assert.equal(renders, SETTLE_FRAMES);
});

test("continued input refreshes the window, so a long drag never stalls", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	// A drag: an input event every frame, for longer than the settle window.
	for (let i = 0; i < SETTLE_FRAMES * 2; i++) {
		pump.interact();
		fake.flush();
	}
	assert.equal(renders, SETTLE_FRAMES * 2, "every frame of the drag drew");
	assert.equal(fake.pending, 1, "still live at the end of the drag");

	// Input stops: the tail drains and the pump goes idle.
	fake.flushFrames(SETTLE_FRAMES * 3);
	assert.equal(fake.pending, 0);
});

test("interact() during a one-shot frame upgrades it to a live loop", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	pump.request();
	pump.interact(); // same frame already scheduled — must not double-schedule, must still go live
	assert.equal(fake.pending, 1);
	fake.flush();
	assert.equal(fake.pending, 1, "the pending one-shot became the first frame of the interaction");
});

test("dispose() cancels the pending frame and stops the tail", () => {
	const fake = fakeScheduler();
	let renders = 0;
	const pump = createRenderPump(() => renders++, fake.scheduler);

	pump.interact();
	pump.dispose();
	assert.equal(fake.pending, 0, "pending frame cancelled");

	fake.flushFrames(5);
	assert.equal(renders, 0, "nothing rendered after dispose");

	// A disposed pump stays dead even if a stray caller pokes it.
	pump.request();
	pump.interact();
	assert.equal(fake.pending, 0, "a disposed pump can never schedule again");
});
