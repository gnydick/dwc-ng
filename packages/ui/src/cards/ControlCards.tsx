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
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { commitPhase, clickSendsSetpoint, staysArmed, thermalMark, type CommitPhase } from "../control/setpointCommit.ts";
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
	// NaN, not 0, for a heater the model doesn't have: 0 is a temperature and
	// would read as "arrived" against a 0 setpoint.
	const heaterReading = (modelIndex: number): number =>
		app.om.om.heat.heaters[modelIndex]?.current ?? Number.NaN;
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
			<div class="heater-list heat-rows">
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
									reading={heaterReading(t().heaters[0] ?? -1)}
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
						reading={heaterReading(bedModelIndex())}
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
	/** The reading. Brightens the engaged key once it reaches that setpoint. */
	reading: number;
	/** Present only for a selectable tool; the bed has none. */
	selectCommand?: string;
	current?: boolean;
}) {
	// Two setpoints, two fields. There was ONE, feeding both buttons, so
	// pressing Standby sent the active field's number as R — a tool could not
	// be given different active and standby targets from this card.
	const [temp, setTemp] = createSignal(props.active);
	const [standbyTemp, setStandbyTemp] = createSignal(props.standby);

	// Re-seed from the machine whenever the MACHINE's setpoint moves — a macro
	// or another client changing it must clear "pending", not leave the button
	// insisting there is something left to send. Keyed on the reported value,
	// so it cannot fire while you type (your keystrokes don't move it).
	createEffect(() => setTemp(props.active));
	createEffect(() => setStandbyTemp(props.standby));

	const activePhase = (): CommitPhase => commitPhase(temp(), props.active, props.state === "active");
	const standbyPhase = (): CommitPhase => commitPhase(standbyTemp(), props.standby, props.state === "standby");

	// Press 1 writes the setpoint and arms; press 2 switches the profile. Armed
	// is dropped once the machine is IN that mode (nothing left to switch to) or
	// the field is edited again (the new value has to be written first), so a
	// key can never be left quietly loaded from minutes ago.
	const [armedActive, setArmedActive] = createSignal(false);
	const [armedStandby, setArmedStandby] = createSignal(false);
	createEffect(() => {
		if (!staysArmed(activePhase(), props.state === "active")) setArmedActive(false);
	});
	createEffect(() => {
		if (!staysArmed(standbyPhase(), props.state === "standby")) setArmedStandby(false);
	});

	// The bed has no mode parameter (M140), so setting its temperature IS
	// turning it on — one command, and no arming step to make sense of.
	const activeCmd = (): string =>
		props.kind === "bed"
			? cmd.bedActive(props.num, temp())
			: clickSendsSetpoint(armedActive())
				? cmd.toolActiveSetpoint(props.num, temp())
				: cmd.toolActive(props.num);
	const standbyCmd = (): string =>
		clickSendsSetpoint(armedStandby())
			? cmd.toolStandbySetpoint(props.num, standbyTemp())
			: cmd.toolStandby(props.num);
	const offCmd = () => (props.kind === "bed" ? cmd.bedOff(props.num) : cmd.toolOff(props.num));

	// Arrival, per mode. Only the engaged key can be at its target, so these are
	// read against the MACHINE's setpoint, not the field — a half-typed number
	// must not brighten anything.
	const activeMark = () => thermalMark(props.reading, props.active);
	const standbyMark = () => thermalMark(props.reading, props.standby);
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
			{/* The READING, ahead of the two setpoints it is being driven toward.
			    Its own fixed-width cell with tabular figures, so a temperature
			    sweeping 21.9 -> 205.0 cannot widen the column and shove the rest
			    of the row sideways. Thermal-keyed like every other reading in the
			    app (the colours are user-configurable in Settings). */}
			<span
				class="heat-read"
				classList={{
					"t-cold": props.reading < 45,
					"t-warm": props.reading >= 45 && props.reading < 160,
					"t-hot": props.reading >= 160,
				}}
				aria-label={`${props.label} current temperature`}
			>
				{Number.isFinite(props.reading) ? props.reading.toFixed(1) : "—"}
				<span class="deg">°C</span>
			</span>
			<label class="temp-field">
				<input class="heat-input" type="number" value={temp()} onInput={e => setTemp(Number(e.currentTarget.value))} aria-label={`${props.label} active target`} />
				<span class="deg">°C</span>
			</label>
			{/* The bed has no standby: M140 has neither a standby nor a mode. */}
			<Show when={props.kind === "tool"}>
				<label class="temp-field">
					<input
						class="heat-input"
						type="number"
						value={standbyTemp()}
						onInput={e => setStandbyTemp(Number(e.currentTarget.value))}
						aria-label={`${props.label} standby target`}
					/>
					<span class="deg">°C</span>
				</label>
			</Show>
			{/* One compact key per mode at the end of the row. Each carries TWO
			    jobs, and which one it will do is on its face before you press
			    it: a pulsing copper dot — the same fixed-size ack dot every
			    send already uses — means the field beside it is unsent, so the
			    click writes the setpoint; no dot means the click sets the mode.
			    See control/setpointCommit.ts for why that multiplexing is only
			    admissible while it stays visible. */}
			<div class="heat-modes">
				<GcodeButton
					label="Act"
					variant="go"
					class="mode-key heat-active"
						atTarget={activeMark() === "near"}
					overWarm={activeMark() === "warm"}
					overHot={activeMark() === "hot"}
					command={activeCmd()}
					stamp={false}
					engaged={props.state === "active"}
					pending={props.kind === "tool" && activePhase() === "pending"}
					applied={armedActive()}
					ackAccent={clickSendsSetpoint(armedActive())}
					onSent={() => setArmedActive(props.kind === "tool" && clickSendsSetpoint(armedActive()))}
					ariaLabel={`${props.label} active${activePhase() === "pending" ? " — set target" : ""}`}
				/>
				{/* The bed's standby cell stays EMPTY rather than closing up, so
				    its A and O keep the tools' columns. */}
				<Show when={props.kind === "tool"}>
					<GcodeButton
						label="Stand"
						class="mode-key heat-standby"
							atTarget={standbyMark() === "near"}
						overWarm={standbyMark() === "warm"}
						overHot={standbyMark() === "hot"}
						command={standbyCmd()}
						stamp={false}
						engaged={props.state === "standby"}
						pending={standbyPhase() === "pending"}
						applied={armedStandby()}
						ackAccent={clickSendsSetpoint(armedStandby())}
						onSent={() => setArmedStandby(clickSendsSetpoint(armedStandby()))}
						ariaLabel={`${props.label} standby${standbyPhase() === "pending" ? " — set target" : ""}`}
					/>
				</Show>
				{/* Off has no setpoint, so it is never pending — one click, always. */}
				<GcodeButton
					label="Off"
					variant="danger"
					class="mode-key heat-off"
						atTarget
					command={offCmd()}
					stamp={false}
					engaged={props.state === "off"}
					ariaLabel={`${props.label} off`}
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
