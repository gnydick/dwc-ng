import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { commitPhase, clickSendsSetpoint, staysArmed, thermalMark, type CommitPhase } from "../control/setpointCommit.ts";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import type { Heater } from "../om/types.ts";
import { HeaterState, isModalState } from "./HeaterState.tsx";
import { describeToolP, parseToolP } from "../control/toolP.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

/**
 * Tools & heaters: one row per tool (current / active / standby / state) plus
 * the bed, which has no standby mode and so never shows a standby cell. A
 * dock-presence dot sits by each tool name (green docked, gold away) from the
 * user-mapped gpIn sensor. Vertical table or horizontal strip via the toggle.
 *
 * The Active and Standby cells are the SETPOINTS, entered here and sent by the
 * buttons beside them (M568 per tool, M140 for the bed) — the row you read is
 * the row you set, so nothing has to be matched up across two cards. Each
 * control is still 1:1 with a G-code; the firmware remains the authority.
 *
 * Content-only body; chrome comes from the compose registry
 * (compose/defs.ts "tools-heaters") or the legacy wrapper below.
 */
export function ToolsHeatersBody(props: {
	orientation: () => Orientation;
	/**
	 * false = READ THE HEAT, DO NOT SET IT. The Tools card renders this same
	 * body with the heater CONTROLS dropped — the Active and Standby entry
	 * columns and the Set column (Act / Stand / Off) are not rendered at all.
	 * What remains is the tool and its reading.
	 *
	 * A prop rather than a second card. The two were separate implementations
	 * that merely agreed: the same five tools at 36px and 45px row pitches,
	 * Current second in one and fifth in the other, headings on one and not the
	 * other. "Identical except for the columns" is now true by construction —
	 * only what is REMOVED can differ.
	 */
	heaterControls?: boolean;
}) {
	const app = useApp();
	const controls = (): boolean => props.heaterControls !== false;

	// Blank means "send no P", which is not the same as P0 — see cmd.selectTool.
	const [toolP, setToolP] = createSignal("");
	const toolPValue = (): number | undefined => parseToolP(toolP());

	const heaterAt = (index: number): Heater | null => app.om.om.heat.heaters[index] ?? null;
	const bedHeaterIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);

	/** docked/away from the user-mapped gpIn sensor; null = unknowable. */
	const dockState = (toolNumber: number): "docked" | "away" | null => {
		const ref = app.config.config.dockSensors[String(toolNumber)];
		if (ref === undefined) return null;
		const gpIn = app.om.om.sensors.gpIn[ref.gpIn];
		if (gpIn === null || gpIn === undefined) return null;
		const active = gpIn.value >= 0.5;
		return (ref.inverted ? !active : active) ? "docked" : "away";
	};

	/** The tool this row is for, or null for the bed (which cannot be selected). */
	const ToolName = (p: {
		name: string;
		des: string;
		dock: "docked" | "away" | null;
		tool: number | null;
	}) => (
		<span class="heat-name">
			{/* The designator leads the row: T0/T1/… (and the bed's heater0) are what
			    you scan down the column to find a row, so they come first. A plain
			    label by design — .des deliberately carries no pointer affordance
			    (see app.css), unlike the clickable .card-tip in a card header. */}
			<span class="des">{p.des}</span>
			{/* Dock presence: a single dot in the second column, between the
			    designator and the name. Green = docked, gold = away. Rows without a
			    dot (the bed, or a tool with no mapped sensor) leave the column empty
			    rather than closing it up — .heat-tool is pinned to column 3 in CSS,
			    so every name still lands on the same x. */}
			<Show when={p.dock}>
				{state => (
					<span
						class={`dock-dot ${state()}`}
						title={state() === "docked" ? "Docked" : "Away"}
						aria-label={state() === "docked" ? "Docked" : "Away"}
					/>
				)}
			</Show>
			{/* The tool's own name IS its selector (T<n>) — the thing you read is the
			    thing you click, and it glows while that tool is the current one. The
			    bed is not selectable, so it stays a plain label sized to match the
			    button so its row keeps the same height. */}
			<Show when={p.tool !== null} fallback={<span class="heat-tool">{p.name}</span>}>
				<GcodeButton
					class="heat-tool tool-select"
					label={p.name}
					variant={app.om.om.state.currentTool === p.tool ? "go" : "quiet"}
					stamp={false}
					engaged={app.om.om.state.currentTool === p.tool}
					command={cmd.selectTool(p.tool ?? 0, toolPValue())}
				/>
			</Show>
		</span>
	);

	return (
		<>
			{/* Deselect and the tool-change bitmask act on the machine, not on one
			    row, so they sit above the rows — over the selector column they
			    govern. P is blank by default, which sends no P at all and lets the
			    firmware run every tool-change macro; P0 suppresses them. Deselect
			    is lit while no tool is current, so the row selectors and this
			    button always show exactly one lit state between them. */}
			<div class="heat-deselect">
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
			<Show
				when={props.orientation() === "horizontal"}
				fallback={
					<table class="heat-table" classList={{ "info-only": !controls() }}>
						<thead>
							<tr>
								<th scope="col">Heater</th>
								{/* No Filament column on either tool card. Loading a material is
								    the Extruders card's job — it owns the pickers, the load and
								    unload macros and the All buttons — and a second picker here
								    was the same control in two places. */}
								<Show when={controls()}>
									<th scope="col">Active</th>
									<th scope="col">Standby</th>
								</Show>
								{/* Reading sits next to acting: Current is the last thing before
								    the buttons, so the number you check and the button you press
								    are the same glance. */}
								<th scope="col">Current</th>
								<Show when={controls()}><th scope="col">Set</th></Show>
							</tr>
						</thead>
						<tbody>
							<For each={app.om.om.tools}>
								{tool => (
									<Show when={tool}>
										{t => (
											<tr>
												<td>
													<ToolName
														name={t().name || `Tool ${t().number}`}
														des={`T${t().number}`}
														dock={dockState(t().number)}
														tool={t().number}
													/>
												</td>
												<Show
													when={heaterAt(t().heaters[0] ?? -1)}
													fallback={<td colspan={controls() ? 3 : 1} class="heat-set">no heater</td>}
												>
													{h => (
														<HeaterCells
															heater={h()}
															index={t().heaters[0] ?? -1}
															kind="tool"
															num={t().number}
															controls={controls()}
														/>
													)}
												</Show>
											</tr>
										)}
									</Show>
								)}
							</For>
							<Show when={heaterAt(bedHeaterIndex())}>
								{h => (
									<tr>
										<td>
											<ToolName name="Bed" des={`heater${bedHeaterIndex()}`} dock={null} tool={null} />
										</td>
										<HeaterCells heater={h()} index={bedHeaterIndex()} kind="bed" num={0} controls={controls()} />
									</tr>
								)}
							</Show>
						</tbody>
					</table>
				}
			>
				<div class="heat-h-row">
					<For each={app.om.om.tools}>
						{tool => (
							<Show when={tool}>
								{t => (
									<div class="heat-h-cell">
										<ToolName
											name={t().name || `Tool ${t().number}`}
											des={`T${t().number}`}
											dock={dockState(t().number)}
											tool={t().number}
										/>
										<Show when={heaterAt(t().heaters[0] ?? -1)} fallback={<span class="heat-set">no heater</span>}>
											{h => (
												<>
													<HeaterCurrent heater={h()} />
													<span class="heat-h-meta">
														<b>{h().active}</b>°&nbsp;/&nbsp;{h().standby}°
														<HeaterState heater={h()} index={t().heaters[0] ?? -1} />
													</span>
													<Show when={controls()}>
														<HeaterActions kind="tool" num={t().number} active={h().active} standby={h().standby} state={h().state} reading={h().current} />
													</Show>
												</>
											)}
										</Show>
									</div>
								)}
							</Show>
						)}
					</For>
					<Show when={heaterAt(bedHeaterIndex())}>
						{h => (
							<div class="heat-h-cell">
								<ToolName name="Bed" des={`heater${bedHeaterIndex()}`} dock={null} tool={null} />
								<HeaterCurrent heater={h()} />
								{/* Active only — no separator trailing off to a standby the bed
								    does not have. */}
								<span class="heat-h-meta">
									<b>{h().active}</b>°
									<HeaterState heater={h()} index={bedHeaterIndex()} />
								</span>
								<Show when={controls()}>
									<HeaterActions kind="bed" num={0} active={h().active} standby={null} state={h().state} reading={h().current} />
								</Show>
							</div>
						)}
					</Show>
				</div>
			</Show>
		</>
	);
}

/**
 * The four data cells of a heater row: current, the two editable setpoints,
 * state, and the buttons that send them. Setpoints seed from the machine's own
 * values and are the operator's from then on — one instance per row, so a poll
 * can never overwrite what is being typed.
 */
function HeaterCells(props: { heater: Heater; index: number; kind: "tool" | "bed"; num: number; controls: boolean }) {
	const [active, setActive] = createSignal(props.heater.active);
	const [standby, setStandby] = createSignal(props.heater.standby);
	const isBed = (): boolean => props.kind === "bed";
	/** Who these single-letter keys belong to — the row identity the face drops. */
	const who = (): string => (isBed() ? "Bed" : `Tool ${props.num}`);

	// Re-seed when the MACHINE's setpoint moves, so another client or a macro
	// clears "pending" rather than leaving a button claiming work to do.
	createEffect(() => setActive(props.heater.active));
	createEffect(() => setStandby(props.heater.standby));

	const activePhase = (): CommitPhase =>
		commitPhase(active(), props.heater.active, props.heater.state === "active");
	const standbyPhase = (): CommitPhase =>
		commitPhase(standby(), props.heater.standby, props.heater.state === "standby");

	// See ControlCards: press 1 writes the setpoint and arms, press 2 switches
	// the profile. No press can activate a heater on its own.
	const [armedActive, setArmedActive] = createSignal(false);
	const [armedStandby, setArmedStandby] = createSignal(false);
	createEffect(() => {
		if (!staysArmed(activePhase(), props.heater.state === "active")) setArmedActive(false);
	});
	createEffect(() => {
		if (!staysArmed(standbyPhase(), props.heater.state === "standby")) setArmedStandby(false);
	});

	// Same two-click model as the Tools card: an unsent field makes the click
	// write the setpoint, a matching field makes it set the mode. The pulsing
	// dot says which. The bed has no mode parameter, so its Active is always
	// the single M140 that both sets and turns on.
	const activeCmd = (): string =>
		isBed()
			? cmd.bedActive(props.num, active())
			: clickSendsSetpoint(armedActive())
				? cmd.toolActiveSetpoint(props.num, active())
				: cmd.toolActive(props.num);
	const standbyCmd = (): string =>
		clickSendsSetpoint(armedStandby())
			? cmd.toolStandbySetpoint(props.num, standby())
			: cmd.toolStandby(props.num);

	return (
		<>
			{/* Active and Standby are SETPOINT ENTRY — controls, so they leave with
			    the Set keys rather than staying on as read-only numbers. A card that
			    only reports shows the reading; a target you cannot change is not
			    what this card is for. */}
			<Show when={props.controls}>
				<td>
					<span class="heat-entry">
						<input
							class="heat-input"
							type="number"
							value={active()}
							onInput={e => setActive(Number(e.currentTarget.value))}
							aria-label={`${who()} active setpoint`}
						/>
					</span>
				</td>
				<td>
					{/* The bed has no standby mode. The CELL stays (the column is what keeps
					    every row's setpoints aligned) but it holds nothing — a placeholder
					    dash just draws the eye to something that isn't there. */}
					<Show when={!isBed()}>
						<span class="heat-entry">
							<input
								class="heat-input"
								type="number"
								value={standby()}
								onInput={e => setStandby(Number(e.currentTarget.value))}
								aria-label={`Tool ${props.num} standby setpoint`}
							/>
						</span>
					</Show>
				</td>
			</Show>
			{/* Current doubles as the slot for states no button can show. On a fault
			    the reading is the thing you cannot trust anyway (a detached
			    thermistor reads wild), and the reset is what you actually need, so
			    the badge takes the cell rather than costing a column of its own. */}
			<td>
				<Show
					when={isModalState(props.heater.state)}
					fallback={<HeaterState heater={props.heater} index={props.index} />}
				>
					<HeaterCurrent heater={props.heater} />
				</Show>
			</td>
			<Show when={props.controls}>
			<td>
				{/* The three keys are modal: the one matching the heater's reported
				    state lights up, which is what the State column used to say in
				    words. Single letters, because each one now sits at the end of a
				    row that already spends its width on two setpoint fields — the
				    aria-label carries the word the face no longer has room for. */}
				<div class="heat-modes">
					<GcodeButton
						label="Act"
						variant="go"
						class="mode-key heat-active"
						atTarget={thermalMark(props.heater.current, props.heater.active) === "near"}
						overWarm={thermalMark(props.heater.current, props.heater.active) === "warm"}
						overHot={thermalMark(props.heater.current, props.heater.active) === "hot"}
						stamp={false}
						engaged={props.heater.state === "active"}
						command={activeCmd()}
						pending={!isBed() && activePhase() === "pending"}
						applied={armedActive()}
						ackAccent={clickSendsSetpoint(armedActive())}
						onSent={() => setArmedActive(!isBed() && clickSendsSetpoint(armedActive()))}
						ariaLabel={`${who()} active${!isBed() && activePhase() === "pending" ? " — set target" : ""}`}
					/>
					{/* The bed has no standby mode, so its column stays EMPTY rather
					    than closing up — Active and Off keep the tools' columns. */}
					<Show when={!isBed()}>
						<GcodeButton
							label="Stand"
							class="mode-key heat-standby"
							atTarget={thermalMark(props.heater.current, props.heater.standby) === "near"}
							overWarm={thermalMark(props.heater.current, props.heater.standby) === "warm"}
							overHot={thermalMark(props.heater.current, props.heater.standby) === "hot"}
							stamp={false}
							engaged={props.heater.state === "standby"}
							command={standbyCmd()}
							pending={standbyPhase() === "pending"}
							applied={armedStandby()}
							ackAccent={clickSendsSetpoint(armedStandby())}
							onSent={() => setArmedStandby(clickSendsSetpoint(armedStandby()))}
							ariaLabel={`${who()} standby${standbyPhase() === "pending" ? " — set target" : ""}`}
						/>
					</Show>
					<GcodeButton
						label="Off"
						variant="danger"
						class="mode-key heat-off"
						atTarget
						stamp={false}
						engaged={props.heater.state === "off"}
						command={isBed() ? cmd.bedOff(props.num) : cmd.toolOff(props.num)}
						ariaLabel={`${who()} off`}
					/>
				</div>
			</td>
			</Show>
		</>
	);
}

/** The horizontal strip's compact actions — the machine's own setpoints, no entry. */
function HeaterActions(props: {
	kind: "tool" | "bed";
	num: number;
	active: number;
	standby: number | null;
	/** heater.state — lights the button for the mode the machine is in. */
	state: string;
	/** The reading, so the engaged key can brighten on arrival. */
	reading: number;
}) {
	const isBed = (): boolean => props.kind === "bed";
	const who = (): string => (isBed() ? "Bed" : `Tool ${props.num}`);
	return (
		<div class="heat-modes">
			<GcodeButton
				label="Act"
				variant="go"
				class="mode-key heat-active"
				atTarget={thermalMark(props.reading, props.active) === "near"}
				overWarm={thermalMark(props.reading, props.active) === "warm"}
				overHot={thermalMark(props.reading, props.active) === "hot"}
				stamp={false}
				engaged={props.state === "active"}
				command={isBed() ? cmd.bedActive(props.num, props.active) : cmd.toolActive(props.num)}
				ariaLabel={`${who()} active`}
			/>
			<Show when={!isBed() && props.standby !== null}>
				<GcodeButton
					label="Stand"
					class="mode-key heat-standby"
					atTarget={thermalMark(props.reading, props.standby) === "near"}
					overWarm={thermalMark(props.reading, props.standby) === "warm"}
					overHot={thermalMark(props.reading, props.standby) === "hot"}
					stamp={false}
					engaged={props.state === "standby"}
					command={cmd.toolStandby(props.num)}
					ariaLabel={`${who()} standby`}
				/>
			</Show>
			<GcodeButton
				label="Off"
				variant="danger"
				class="mode-key heat-off"
						atTarget
				stamp={false}
				engaged={props.state === "off"}
				command={isBed() ? cmd.bedOff(props.num) : cmd.toolOff(props.num)}
				ariaLabel={`${who()} off`}
			/>
		</div>
	);
}

function HeaterCurrent(props: { heater: Heater }) {
	return (
		<span
			class="heat-cur"
			classList={{
				"t-cold": props.heater.current < 45,
				"t-warm": props.heater.current >= 45 && props.heater.current < 160,
				"t-hot": props.heater.current >= 160,
			}}
		>
			{props.heater.current.toFixed(1)}<small>°C</small>
		</span>
	);
}
