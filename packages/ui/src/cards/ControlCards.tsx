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
import { describeToolP, parseToolP } from "../control/toolP.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

export function AtxBody() {
	const app = useApp();
	// atxPower is null on a board with no PS_ON port. Say so rather than offer a
	// DEAD switch — but keep the card visible, not vanished.
	return (
		<Show when={app.om.om.state.atxPower !== null} fallback={<p class="job-empty">This machine has no ATX power control.</p>}>
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

export function HeatersBody() {
	const app = useApp();
	// Blank means "send no P", which is not the same as P0 - see cmd.selectTool.
	const [toolP, setToolP] = createSignal("");
	const toolPValue = (): number | undefined => parseToolP(toolP());
	const heaterActive = (modelIndex: number): number =>
		app.om.om.heat.heaters[modelIndex]?.active ?? 0;
	const heaterStandby = (modelIndex: number): number =>
		app.om.om.heat.heaters[modelIndex]?.standby ?? 0;
	// "" for a heater the model doesn't have: no mode button lights up, rather
	// than one lighting up on a guess.
	const heaterState = (modelIndex: number): string =>
		app.om.om.heat.heaters[modelIndex]?.state ?? "";
	const bedModelIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);
	return (
		<>
			{/* Deselect and the tool-change bitmask act on the machine, not on one
			    tool, so they sit above the rows. P blank sends no P at all; P0
			    suppresses tfree/tpre/tpost, decoded beside the field. */}
			<div class="tool-p">
				{/* Lit while no tool is current, so this and the row selectors always
				    show exactly one lit state between them — same as the table. */}
				<GcodeButton
					label="Deselect"
					variant="quiet"
					stamp={false}
					engaged={app.om.om.state.currentTool < 0}
					command={cmd.deselectTool(toolPValue())}
				/>
				<label class="feed-field">
					P
					<input
						type="number"
						min="0"
						max="7"
						placeholder="all"
						value={toolP()}
						onInput={e => setToolP(e.currentTarget.value)}
						aria-label="Tool change macro bitmask"
					/>
				</label>
				<span class="tool-p-decode">{describeToolP(toolPValue())}</span>
			</div>
			<div class="heater-list">
				<For each={app.om.om.tools}>
					{tool => (
						<Show when={tool}>
							{t => (
								<HeaterControl
									label={t().name || `Tool ${t().number}`}
									kind="tool"
									num={t().number}
									active={heaterActive(t().heaters[0] ?? -1)}
									standby={heaterStandby(t().heaters[0] ?? -1)}
									state={heaterState(t().heaters[0] ?? -1)}
									selectCommand={cmd.selectTool(t().number, toolPValue())}
									current={app.om.om.state.currentTool === t().number}
								/>
							)}
						</Show>
					)}
				</For>
				<Show when={bedModelIndex() >= 0}>
					<HeaterControl
						label="Bed"
						kind="bed"
						num={0}
						active={heaterActive(bedModelIndex())}
						standby={0}
						state={heaterState(bedModelIndex())}
					/>
				</Show>
			</div>
		</>
	);
}

export function FansBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	// The fan's own index goes to M106 P<n>, so it is carried alongside — a
	// filtered list can't renumber the fans.
	const manualFans = createMemo(() =>
		app.om.om.fans.flatMap((fan, i) => (isManualFan(fan) ? [{ fan, i }] : [])),
	);
	return (
		<Show when={manualFans().length > 0} fallback={<p class="job-empty">This machine has no adjustable fans.</p>}>
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

function HeaterControl(props: {
	label: string;
	kind: "tool" | "bed";
	num: number;
	active: number;
	/** Reported standby setpoint. Always 0 for the bed, which has no standby. */
	standby: number;
	/** heat.heaters[].state — lights the mode button the machine is in. */
	state: string;
	/** Present only for a selectable tool; the bed has none. */
	selectCommand?: string;
	current?: boolean;
}) {
	// Two setpoints, two fields. There was ONE, feeding both buttons, so
	// pressing Standby sent the active field's number as R — a tool could not
	// be given different active and standby targets from this card.
	const [temp, setTemp] = createSignal(props.active > 0 ? props.active : 0);
	const [standbyTemp, setStandbyTemp] = createSignal(props.standby > 0 ? props.standby : 0);
	// The bed has no mode parameter (M140), so its Active still carries the
	// setpoint; a tool's mode buttons are pure A2/A1/A0 and SET carries both.
	const activeCmd = () => (props.kind === "bed" ? cmd.bedActive(props.num, temp()) : cmd.toolActive(props.num));
	const offCmd = () => (props.kind === "bed" ? cmd.bedOff(props.num) : cmd.toolOff(props.num));
	return (
		<div class="heater-ctl">
			{/* A tool's own label IS its selector (T<n>) - the thing you read is the
			    thing you click. The bed is not selectable and stays a plain label.
			    Selection is modal too — exactly one tool is current — so it wears
			    the same glow as the mode buttons, on top of the label colour it
			    already had. */}
			<Show when={props.selectCommand} fallback={<span class="ctl-name">{props.label}</span>}>
				{command => (
					<GcodeButton
						class="ctl-name tool-select"
						label={props.label}
						variant={props.current ? "go" : "quiet"}
						stamp={false}
						engaged={props.current}
						command={command()}
					/>
				)}
			</Show>
			<label class="temp-field">
				<input type="number" value={temp()} onInput={e => setTemp(Number(e.currentTarget.value))} aria-label={`${props.label} active target`} />
				<span class="deg">°C</span>
			</label>
			{/* Standby field + the commit. The bed gets neither: M140 has no
			    standby and no mode, so its Active button already IS its commit. */}
			<Show when={props.kind === "tool"}>
				<label class="temp-field">
					<input
						type="number"
						value={standbyTemp()}
						onInput={e => setStandbyTemp(Number(e.currentTarget.value))}
						aria-label={`${props.label} standby target`}
					/>
					<span class="deg">°C</span>
				</label>
				{/* Explicit commit — nothing is sent by a field losing focus.
				    Sends BOTH setpoints and leaves the mode alone. */}
				<GcodeButton
					label="Set"
					class="heat-set-btn"
					stamp={false}
					command={cmd.toolSetpoints(props.num, temp(), standbyTemp())}
					ariaLabel={`Set ${props.label} active and standby targets`}
				/>
			</Show>
			{/* Modal, exactly as in the Tools & heaters card: the button for the
			    mode the machine reports lights up. Still 1:1 with its G-code and
			    still clickable when lit — re-sending Active after editing the
			    target is the normal way to use this. */}
			<div class="btn-cluster heat-modes">
				<GcodeButton
					label="Active"
					variant="go"
					class="heat-active"
					command={activeCmd()}
					stamp={false}
					engaged={props.state === "active"}
				/>
				{/* The bed has no standby mode; its column stays EMPTY so Active and
				    Off stay under the tools' Active and Off. */}
				<Show when={props.kind === "tool"}>
					<GcodeButton
						label="Standby"
						class="heat-standby"
						command={cmd.toolStandby(props.num)}
						stamp={false}
						engaged={props.state === "standby"}
					/>
				</Show>
				<GcodeButton
					label="Off"
					variant="danger"
					class="heat-off"
					command={offCmd()}
					stamp={false}
					engaged={props.state === "off"}
				/>
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
