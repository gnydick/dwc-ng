/**
 * Frame scheduling for the on-demand-rendered G-code scene (see scene.ts).
 *
 * The viewer deliberately does NOT run an unconditional 60fps loop — a large
 * toolpath is real per-frame GPU cost and a static preview has nothing new to
 * draw. But "render only when something changed" collides with how Babylon's
 * camera controls actually work:
 *
 *   - The pointer/wheel/touch input classes only ACCUMULATE pixel deltas onto
 *     camera.movement.{pan,rotation,zoom}AccumulatedPixels
 *     (Cameras/Inputs/arcRotateCameraPointersInput.js). They never move the
 *     camera and never ask for a frame.
 *   - The camera is actually moved by ArcRotateCamera._checkInputs(), which
 *     calls movement.computeCurrentFrameDeltas() — and _checkInputs() runs
 *     ONLY from inside scene.render().
 *
 * So with on-demand rendering and nothing wiring input to a frame request, no
 * frame means no camera movement: a drag accumulates pixels that are only
 * consumed whenever some unrelated event (a live-position poll tick, a resize)
 * happens to schedule a frame. That is exactly the "very latent" input this
 * module fixes.
 *
 * One frame per input event still isn't enough. Babylon decays the velocity
 * with a framerate-INDEPENDENT factor, inertia^(deltaMs/16.67)
 * (cameraMovement.js getFrameIndependentDecay) — at the default inertia of 0.9
 * that's a wall-clock time constant of ~158ms, so the camera keeps gliding for
 * roughly half a second to a second after the last pointer event. That glide
 * only happens on frames we schedule. Hence the settle tail below: input keeps
 * frames coming until the motion has actually died out, then the pump returns
 * to fully idle (zero frames, zero GPU) until something asks again.
 *
 * The scheduler is injected so the policy is testable without a DOM or a GPU
 * (test/render-pump.test.ts); scene.ts passes requestAnimationFrame.
 */

/**
 * Frames to keep rendering after the most recent input event. At 60fps this is
 * ~750ms, comfortably past the ~158ms decay constant described above (the
 * velocity is into Babylon's epsilon cutoff well before then). At a lower frame
 * rate the same count covers MORE wall clock, which only over-covers — it can
 * never cut the glide short.
 */
export const SETTLE_FRAMES = 45;

/** Injectable requestAnimationFrame/cancelAnimationFrame pair. */
export interface FrameScheduler {
	request(callback: () => void): number;
	cancel(handle: number): void;
}

export interface RenderPump {
	/** Something changed (geometry, colors, tool position, size): draw one frame. */
	request(): void;
	/** The user is driving the camera: draw every frame until the motion settles. */
	interact(): void;
	/** Cancels any pending frame and permanently retires the pump. */
	dispose(): void;
}

/**
 * Creates the pump. Two invariants hold by construction, because every frame in
 * this module is scheduled through the single `schedule()` below:
 *   - At most one frame is ever in flight (`handle !== 0` guards it), so callers
 *     may request as freely as they like and never stack up duplicate renders.
 *   - The tail always terminates: `remaining` is only ever set by `interact()`
 *     and strictly decremented per frame, so with no further input the pump
 *     reaches zero and stops. It cannot degrade into an unconditional loop.
 */
export function createRenderPump(
	render: () => void,
	scheduler: FrameScheduler,
	settleFrames: number = SETTLE_FRAMES,
): RenderPump {
	let handle = 0;
	let remaining = 0;
	let disposed = false;

	const onFrame = (): void => {
		handle = 0;
		render();
		// Decrement BEFORE rescheduling: a window of N must run exactly N frames.
		if (remaining > 0) {
			remaining--;
			if (remaining > 0) schedule();
		}
	};

	function schedule(): void {
		if (disposed || handle !== 0) return;
		handle = scheduler.request(onFrame);
	}

	return {
		request: schedule,
		interact(): void {
			if (disposed) return;
			// Refreshes the window on every event, so a drag of any length stays
			// live and only the trailing glide is bounded by settleFrames.
			remaining = settleFrames;
			schedule();
		},
		dispose(): void {
			disposed = true;
			remaining = 0;
			if (handle !== 0) {
				scheduler.cancel(handle);
				handle = 0;
			}
		},
	};
}
