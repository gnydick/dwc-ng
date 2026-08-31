import { For, createSignal, onCleanup } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "./commands.ts";
import { createSpeedHold } from "./speedHold.ts";
import { GcodeButton } from "./GcodeButton.tsx";
import { speedStepDown, speedStepUp } from "./speedScale.ts";

type SendState = "idle" | "sending" | "sent" | "failed";

/**
 * Speed factor (M220) as a slider whose scale is always 0 .. 2x the current
 * speed, so the handle sits mid-bar and the control gives its finest resolution
 * around wherever the machine actually is. Quarter-scale stops sit beneath the
 * bar as snap targets.
 *
 * **Order of events on release** — this is the whole design:
 *
 *   1. the dragged value becomes the centre immediately,
 *   2. the scale recalculates around it (so the handle is mid-bar again),
 *   3. the machine catches up on a later poll, and the hand-off is invisible
 *      because the scale it then derives already equals the one on screen.
 *
 * Unfreezing at step 1 instead — which is what this did first — reverts the
 * scale to the OLD centre, snaps the handle back, and then jumps a second time
 * when the poll lands: three visible states where there should be one.
 *
 * The scale is also frozen DURING the drag, for the same reason in miniature:
 * it derives from the current speed and the drag is what changes that speed, so
 * a live scale would rescale under the finger.
 *
 * The command is sent once per completed value-change gesture, never per input
 * event: RRF tolerates very few requests and streaming one M220 per pixel — or
 * per auto-repeat arrow step — would flood it. That invariant is held by the
 * shared machine in rangeGesture.ts (keyboard events are not wired at all;
 * only value changes open a gesture), falsified by range-gesture.test.ts.
 * Stops and the reset send at once, being single deliberate acts.
 */
export function SpeedSlider(props: { currentPct: number }) {
	const app = useApp();
	const [state, setState] = createSignal<SendState>("idle");
	const [error, setError] = createSignal("");

	let ackTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(ackTimer));

	const send = async (pct: number): Promise<void> => {
		clearTimeout(ackTimer);
		setState("sending");
		setError("");
		// Step 1 and 2: the requested value IS the centre now, and the scale
		// recalculates around it before the machine has said anything.
		hold.claim(pct);
		try {
			await app.connector.sendCode(cmd.speedFactor(pct));
			setState("sent");
			ackTimer = setTimeout(() => setState("idle"), 1100);
		} catch (err) {
			// It never took. Go back to what the machine actually has rather than
			// leaving a speed on screen that nothing is running at.
			setState("failed");
			setError(err instanceof Error ? err.message : String(err));
			hold.release();
		}
	};

	// The freeze/follow machine and the shared range gesture, as ONE module
	// (speedHold.ts) so speed-hold.test.ts drives the exact wiring on screen.
	// The historical release-order bug — Solid re-entering the
	// follow-the-machine effect on the drag flag dropping and clobbering the
	// dragged value — cannot recur because the gesture machine passes the
	// final value INTO onSend and invokes onSend before onActive(false);
	// send(pct) claims the commit (hold.claim) before the flag drops. The
	// same ordering is why a NET-ZERO gesture unfreezes the scale: no send,
	// no claim, so completion clears the grab-time centre (the inc 2 review's
	// permanent-freeze fix, pinned by speed-hold.test.ts).
	const hold = createSpeedHold({
		currentPct: () => props.currentPct,
		send: pct => void send(pct),
	});
	const { value, setValue, scale, gesture } = hold;

	/**
	 * Thumb width, so the stops line up with where the thumb CENTRE can
	 * actually reach: half a thumb is unreachable travel at either end.
	 *
	 * A literal 14, deliberately, and the one number here that must not be
	 * written in `u`: the thumb is a frozen pointer target
	 * (`.speed-input::-webkit-slider-thumb`, app.css — `px-ok: hit target`),
	 * so an offset in `u` would walk away from it at every scale but 1 and
	 * the dots would stop marking the values they name. Change one and you
	 * must change the other; each says so.
	 */
	const THUMB_PX = 14;
	const stopOffset = (stop: number): string => {
		const fraction = scale().max === 0 ? 0 : stop / scale().max;
		return `calc(${THUMB_PX / 2}px + ${fraction} * (100% - ${THUMB_PX}px))`; // px-ok: mirrors the frozen 14px thumb in app.css
	};

	return (
		<div class="speed-row">
			<GcodeButton label="100%" variant="quiet" command={cmd.speedFactor(100)} stamp={false} />
			<span class="ctl-name">Speed</span>
			<div class="speed-track">
				<input
					class="speed-input"
					type="range"
					min="0"
					max={scale().max}
					step="1"
					value={value()}
					aria-label="Speed factor percent"
					onPointerDown={() => gesture.down(value())}
					onPointerUp={gesture.up}
					onPointerCancel={gesture.up}
					onBlur={gesture.blur}
					onInput={e => {
						const next = Number(e.currentTarget.value);
						const prev = value();
						setValue(next);
						gesture.change(prev, next);
					}}
				/>
				<div class="speed-stops">
					<For each={scale().stops}>
						{stop => (
							<button
								class="speed-stop"
								classList={{ current: stop === Math.round(value()) }}
								style={{ left: stopOffset(stop) }}
								title={cmd.speedFactor(stop)}
								aria-label={`Set speed to ${stop} percent`}
								onClick={() => void send(stop)}
							/>
						)}
					</For>
				</div>
			</div>
			{/* Snap-to-5 nudge, next to the track. Sends through the same send()
			    the slider uses, so the scale re-centres identically. */}
			<div class="speed-step">
				<button
					class="fb-act"
					title={cmd.speedFactor(speedStepDown(Math.round(value())))}
					aria-label="Speed down to previous 5%"
					onClick={() => void send(speedStepDown(Math.round(value())))}
				>−</button>
				<button
					class="fb-act"
					title={cmd.speedFactor(speedStepUp(Math.round(value())))}
					aria-label="Speed up to next 5%"
					onClick={() => void send(speedStepUp(Math.round(value())))}
				>+</button>
			</div>
			{/* Tabular figures and a reserved width: this changes on every poll and
			    must not shove the track around as the digit count changes. */}
			<span
				class="speed-value"
				classList={{ "is-sent": state() === "sent", "is-failed": state() === "failed" }}
			>
				{Math.round(value())}%
			</span>
			{/* Always present so a refusal cannot reflow the row it appears in. */}
			<span class="speed-error" classList={{ show: error() !== "" }} title={error()}>
				{error() === "" ? " " : "refused"}
			</span>
		</div>
	);
}
