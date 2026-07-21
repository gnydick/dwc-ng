import { For, createEffect, createSignal, onCleanup } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "./commands.ts";
import { GcodeButton } from "./GcodeButton.tsx";
import { speedScale, type SpeedScale } from "./speedScale.ts";

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
 * The command is sent on release, not per input event: RRF tolerates very few
 * requests and streaming one M220 per pixel would flood it. Stops and the reset
 * send at once, being single deliberate acts.
 */
export function SpeedSlider(props: { currentPct: number }) {
	const app = useApp();
	const [dragging, setDragging] = createSignal(false);
	const [value, setValue] = createSignal(props.currentPct);
	const [state, setState] = createSignal<SendState>("idle");
	const [error, setError] = createSignal("");

	/**
	 * The centre the scale is built around while we are ahead of the machine:
	 * during a drag, and after one until the machine reports the new speed.
	 * null means "follow the machine".
	 */
	const [centre, setCentre] = createSignal<number | null>(null);
	/** What we asked the machine for, so we can tell when it has caught up. */
	const [target, setTarget] = createSignal<number | null>(null);

	let ackTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(ackTimer));

	const scale = (): SpeedScale => speedScale(centre() ?? props.currentPct);

	// Follow the machine, except while the operator is holding the handle or a
	// commanded change is still in flight — either would clobber the value the
	// operator is looking at with a reading we know to be stale.
	createEffect(() => {
		const live = props.currentPct;
		if (!dragging() && target() === null) setValue(live);
	});

	// The machine caught up: hand back to it. No jump, because the scale it
	// derives from `live` is the scale already on screen.
	createEffect(() => {
		const live = props.currentPct;
		const want = target();
		if (want !== null && Math.round(live) === Math.round(want)) {
			setTarget(null);
			setCentre(null);
		}
	});

	const send = async (pct: number): Promise<void> => {
		clearTimeout(ackTimer);
		setState("sending");
		setError("");
		// Step 1 and 2: the requested value IS the centre now, and the scale
		// recalculates around it before the machine has said anything.
		setValue(pct);
		setCentre(pct);
		setTarget(pct);
		try {
			await app.connector.sendCode(cmd.speedFactor(pct));
			setState("sent");
			ackTimer = setTimeout(() => setState("idle"), 1100);
		} catch (err) {
			// It never took. Go back to what the machine actually has rather than
			// leaving a speed on screen that nothing is running at.
			setState("failed");
			setError(err instanceof Error ? err.message : String(err));
			setTarget(null);
			setCentre(null);
			setValue(props.currentPct);
		}
	};

	const grab = (): void => {
		setCentre(props.currentPct); // freeze the scale for the duration of the drag
		setDragging(true);
	};

	const release = (): void => {
		if (!dragging()) return;
		setDragging(false);
		void send(value());
	};

	/** Thumb width — stops line up with where the thumb centre can actually reach. */
	const THUMB_PX = 14;
	const stopOffset = (stop: number): string => {
		const fraction = scale().max === 0 ? 0 : stop / scale().max;
		return `calc(${THUMB_PX / 2}px + ${fraction} * (100% - ${THUMB_PX}px))`;
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
					onPointerDown={grab}
					onPointerUp={release}
					onKeyDown={grab}
					onKeyUp={release}
					onInput={e => setValue(Number(e.currentTarget.value))}
					onChange={release}
				/>
				<div class="speed-stops">
					<For each={scale().stops}>
						{stop => (
							<button
								class="speed-stop"
								classList={{ current: stop === Math.round(value()) }}
								style={{ left: stopOffset(stop) }}
								title={`M220 S${stop}`}
								aria-label={`Set speed to ${stop} percent`}
								onClick={() => void send(stop)}
							/>
						)}
					</For>
				</div>
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
