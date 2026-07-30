/**
 * The Control surface's eight card bodies — every control 1:1 with G-code,
 * wearing its command (the signature). No GUI-encoded safety: the firmware is
 * the authority; rejected commands show their reply in the console.
 *
 * Extracted from views/Control.tsx in the A4 conversion. All state here is
 * card-local (step sizes, feeds, targets) — none of it crosses cards, which
 * is what made this a pure extraction. Chrome/visibility live in
 * compose/defs.ts; these are content-only bodies.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import { SpeedSlider } from "../control/SpeedSlider.tsx";
import { FilamentCard } from "../control/FilamentCard.tsx";
import { isManualFan } from "../om/fans.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

export function AtxBody() {
	const app = useApp();
	// atxPower is null on a board with no PS_ON port. Say so rather than offer a
	// DEAD switch — but keep the card visible, not vanished.
	return (
		<Show when={app.om.om.state.atxPower !== null} fallback={<p class="job-empty">No ATX control</p>}>
			<div class="ctl-wrap">
				<GcodeButton label="PSU On" variant="go" command={cmd.atxPower(true)} />
				<GcodeButton label="PSU Off" variant="danger" command={cmd.atxPower(false)} />
			</div>
		</Show>
	);
}

export function FilamentBody() {
	const app = useApp();
	return <FilamentCard tools={app.om.om.tools} />;
}

export function FansBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	// The fan's own index goes to M106 P<n>, so it is carried alongside — a
	// filtered list can't renumber the fans.
	const manualFans = createMemo(() =>
		app.om.om.fans.flatMap((fan, i) => (isManualFan(fan) ? [{ fan, i }] : [])),
	);
	return (
		<Show when={manualFans().length > 0} fallback={<p class="job-empty">No adjustable fans</p>}>
			<div class="heater-list" classList={{ horizontal: props.orientation() === "horizontal" }}>
				<For each={manualFans()}>
					{entry => (
						<FanControl
							label={entry.fan.name || `Fan ${entry.i}`}
							index={entry.i}
							actual={entry.fan.actualValue}
							requested={entry.fan.requestedValue}
							rpm={entry.fan.rpm}
						/>
					)}
				</For>
			</div>
		</Show>
	);
}

export function TuningBody() {
	const app = useApp();
	const [babyStep, setBabyStep] = createSignal(0.02);
	// The machine's own accumulated offset (move.axes[].babystep) — the
	// firmware reports it, we only mirror. Signed and fixed-width so the
	// readout can't jitter the row as it changes.
	const applied = createMemo(() => {
		const z = app.om.om.move.axes.find(a => a.letter === "Z");
		return z?.babystep ?? 0;
	});
	const appliedLabel = (): string => `${applied() > 0 ? "+" : ""}${applied().toFixed(2)}`;
	return (
		<div class="heater-list">
			<SpeedSlider currentPct={Math.round((app.om.om.move.speedFactor ?? 1) * 100)} />
			<div class="heater-ctl">
				<span class="ctl-name">Babystep Z</span>
				<span
					class="baby-applied"
					classList={{ "is-live": applied() !== 0 }}
					title="Accumulated Z babystep the firmware is applying (move.axes Z.babystep)"
				>
					{appliedLabel()}
				</span>
				<label class="feed-field">mm <input type="number" step="0.01" value={babyStep()} onInput={e => setBabyStep(Number(e.currentTarget.value))} /></label>
				<div class="btn-cluster">
					<GcodeButton label={`− ${babyStep()}`} command={cmd.babystep(-babyStep())} stamp={false} />
					<GcodeButton label={`+ ${babyStep()}`} command={cmd.babystep(babyStep())} stamp={false} />
					<GcodeButton label="Zero" command={cmd.babystepZero()} variant="quiet" stamp={false} />
				</div>
			</div>
		</div>
	);
}

function FanControl(props: { label: string; index: number; actual: number; requested: number; rpm: number }) {
	const app = useApp();
	// Seeded from the requested value (the last set point), then operator-owned
	// — one instance, so a poll never overwrites what is being typed.
	const [pct, setPct] = createSignal(Math.round((props.requested ?? 0) * 100));
	const key = `fan:${props.index}`;

	const pinCommand = (): string => cmd.fan(props.index, pct());
	const pinned = (): boolean => app.config.config.pins.some(p => p.key === key && p.enabled);
	const togglePin = (): void => {
		if (pinned()) app.config.removeKeyedPin(key);
		else app.config.setKeyedPin(key, pinCommand(), true);
	};

	return (
		<div class="heater-ctl">
			<span class="ctl-name">{props.label}</span>
			{/* Readouts sit in ONE fixed-width block so the % input starts at the
			    same x on every fan row — the alignment fix. Actual is the live
			    value the firmware reports (distinct from the requested set point);
			    RPM is the tacho, its slot RESERVED even when there is no tacho so a
			    fan without one still lines its input up with the rest. */}
			<span class="fan-readouts">
				<span class="fan-actual" title="Actual speed (fans[].actualValue)">{Math.round(props.actual * 100)}<small>%</small></span>
				<span class="fan-rpm" title="Tacho reading (fans[].rpm)">
					<Show when={props.rpm >= 0}>{props.rpm}<small>rpm</small></Show>
				</span>
			</span>
			<label class="temp-field">
				<input type="number" min="0" max="100" value={pct()} onInput={e => setPct(Number(e.currentTarget.value))} aria-label={`${props.label} percent`} />
				<span class="deg">%</span>
			</label>
			<div class="btn-cluster">
				{/* Modal exactly like the Tools & Heaters card's Active/Off pair:
				    whichever mode the fan is currently IN lights up (fills) — Set
				    (go → green) while the fan is running, Off (danger → copper) while
				    it is stopped. Same heat-active/heat-off classes and engaged
				    logic, so the lit colours match that card to the pixel. Set also
				    re-pins at the new value when pinned, so the override tracks what
				    you just set. */}
				<GcodeButton
					label="Set"
					variant="go"
					class="heat-active"
					command={pinCommand()}
					stamp={false}
					engaged={props.requested > 0}
					onSent={() => { if (pinned()) app.config.setKeyedPin(key, pinCommand(), true); }}
				/>
				<GcodeButton
					label="Off"
					variant="danger"
					class="heat-off"
					command={cmd.fan(props.index, 0)}
					stamp={false}
					engaged={props.requested === 0}
				/>
				{/* Pin holds this fan at the set speed against the job (M106 re-sent
				    every 0.5s). Glows while pinned; a config write, not a G-code. */}
				<button
					class="fb-tool fan-pin"
					classList={{ "is-engaged": pinned() }}
					aria-pressed={pinned()}
					title={pinned() ? "Pinned — overriding the job. Click to release." : "Pin this speed to override the job"}
					onClick={togglePin}
				>
					Pin
				</button>
			</div>
		</div>
	);
}
