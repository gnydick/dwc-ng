import { For, createEffect, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "./commands.ts";
import { GcodeButton } from "./GcodeButton.tsx";
import { speedScale, type SpeedScale } from "./speedScale.ts";

/**
 * Speed factor (M220) as a slider whose scale is always 0 .. 2x the machine's
 * current speed, so the handle sits mid-bar and the control gives its finest
 * resolution around wherever the machine actually is. Quarter-scale stops sit
 * on the bar as snap targets; the middle one is always the current speed.
 *
 * Two things this has to get right:
 *
 *  - The scale is FROZEN while you drag. It is derived from the current speed,
 *    and the current speed is what the drag changes — left live, the bar would
 *    rescale under the finger mid-gesture and the handle would run away.
 *  - The command is sent on release, not on every input event. RRF tolerates
 *    very few requests; streaming one per pixel would flood the board with
 *    M220s the operator never asked for. The dots and the reset send at once,
 *    because those are single deliberate acts.
 */
export function SpeedSlider(props: { currentPct: number }) {
	const app = useApp();
	const [dragging, setDragging] = createSignal(false);
	const [frozen, setFrozen] = createSignal<SpeedScale | null>(null);
	const [value, setValue] = createSignal(props.currentPct);

	const scale = (): SpeedScale => frozen() ?? speedScale(props.currentPct);

	// Follow the machine whenever the operator isn't holding the handle.
	createEffect(() => {
		const live = props.currentPct;
		if (!dragging()) setValue(live);
	});

	const send = (pct: number): void => {
		void app.connector.sendCode(cmd.speedFactor(pct)).catch(() => undefined);
	};

	const grab = (): void => {
		setFrozen(speedScale(props.currentPct));
		setDragging(true);
	};

	const release = (): void => {
		if (!dragging()) return;
		setDragging(false);
		setFrozen(null);
		send(value());
	};

	/** Thumb width — the dots must sit where the thumb CENTRE can actually reach. */
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
				{/* Snap stops, drawn over the track at quarters of the scale. Rendered
				    after the input so they take the clicks that land on them. */}
				<div class="speed-stops">
					<For each={scale().stops}>
						{stop => (
							<button
								class="speed-stop"
								classList={{ current: stop === Math.round(props.currentPct) }}
								style={{ left: stopOffset(stop) }}
								title={`M220 S${stop}`}
								aria-label={`Set speed to ${stop} percent`}
								onClick={() => send(stop)}
							/>
						)}
					</For>
				</div>
			</div>
			{/* Tabular figures and a reserved width: this changes on every poll and
			    must not shove the track around as the digit count changes. */}
			<span class="speed-value">{Math.round(value())}%</span>
		</div>
	);
}
