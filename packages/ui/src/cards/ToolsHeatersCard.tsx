import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import type { Heater } from "../om/types.ts";
import { HeaterState } from "./HeaterState.tsx";
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
export function ToolsHeatersBody(props: { orientation: () => Orientation }) {
	const app = useApp();

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

	const ToolName = (p: { name: string; des: string; dock: "docked" | "away" | null }) => (
		<span class="heat-name">
			{/* The designator leads the row: T0/T1/… (and the bed's heater0) are the
			    copy tips you scan and click, so they get the first column. */}
			<span class="des">{p.des}</span>
			<span class="heat-tool">{p.name}</span>
			{/* Dock presence: a single dot by the tool, no column to scroll off.
			    Green = docked, gold = away. */}
			<Show when={p.dock}>
				{state => (
					<span
						class={`dock-dot ${state()}`}
						title={state() === "docked" ? "Docked" : "Away"}
						aria-label={state() === "docked" ? "Docked" : "Away"}
					/>
				)}
			</Show>
		</span>
	);

	return (
		<>
			<Show
				when={props.orientation() === "horizontal"}
				fallback={
					<table class="heat-table">
						<thead>
							<tr>
								<th scope="col">Heater</th>
								<th scope="col">Current</th>
								<th scope="col">Active</th>
								<th scope="col">Standby</th>
								<th scope="col">State</th>
								<th scope="col">Set</th>
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
													/>
												</td>
												<Show
													when={heaterAt(t().heaters[0] ?? -1)}
													fallback={<td colspan="5" class="heat-set">no heater</td>}
												>
													{h => (
														<HeaterCells
															heater={h()}
															index={t().heaters[0] ?? -1}
															kind="tool"
															num={t().number}
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
											<ToolName name="Bed" des={`heater${bedHeaterIndex()}`} dock={null} />
										</td>
										<HeaterCells heater={h()} index={bedHeaterIndex()} kind="bed" num={0} />
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
										/>
										<Show when={heaterAt(t().heaters[0] ?? -1)} fallback={<span class="heat-set">no heater</span>}>
											{h => (
												<>
													<HeaterCurrent heater={h()} />
													<span class="heat-h-meta">
														<b>{h().active}</b>°&nbsp;/&nbsp;{h().standby}°
														<HeaterState heater={h()} index={t().heaters[0] ?? -1} />
													</span>
													<HeaterActions kind="tool" num={t().number} active={h().active} standby={h().standby} />
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
								<ToolName name="Bed" des={`heater${bedHeaterIndex()}`} dock={null} />
								<HeaterCurrent heater={h()} />
								<span class="heat-h-meta">
									<b>{h().active}</b>°&nbsp;/&nbsp;—
									<HeaterState heater={h()} index={bedHeaterIndex()} />
								</span>
								<HeaterActions kind="bed" num={0} active={h().active} standby={null} />
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
function HeaterCells(props: { heater: Heater; index: number; kind: "tool" | "bed"; num: number }) {
	const [active, setActive] = createSignal(props.heater.active);
	const [standby, setStandby] = createSignal(props.heater.standby);
	const isBed = (): boolean => props.kind === "bed";

	return (
		<>
			<td><HeaterCurrent heater={props.heater} /></td>
			<td>
				<input
					class="heat-input"
					type="number"
					value={active()}
					onInput={e => setActive(Number(e.currentTarget.value))}
					aria-label={`${isBed() ? "Bed" : `Tool ${props.num}`} active setpoint`}
				/>
			</td>
			<td>
				{/* the bed has no standby mode — no standby cell, ever */}
				<Show when={!isBed()} fallback={<span class="heat-set">—</span>}>
					<input
						class="heat-input"
						type="number"
						value={standby()}
						onInput={e => setStandby(Number(e.currentTarget.value))}
						aria-label={`Tool ${props.num} standby setpoint`}
					/>
				</Show>
			</td>
			<td><HeaterState heater={props.heater} index={props.index} /></td>
			<td>
				<div class="heat-actions">
					<GcodeButton
						label="Active"
						variant="go"
						stamp={false}
						command={isBed() ? cmd.bedActive(props.num, active()) : cmd.toolActive(props.num, active())}
					/>
					<Show when={!isBed()}>
						<GcodeButton label="Standby" stamp={false} command={cmd.toolStandby(props.num, standby())} />
					</Show>
					<GcodeButton
						label="Off"
						variant="danger"
						stamp={false}
						command={isBed() ? cmd.bedOff(props.num) : cmd.toolOff(props.num)}
					/>
				</div>
			</td>
		</>
	);
}

/** The horizontal strip's compact actions — the machine's own setpoints, no entry. */
function HeaterActions(props: { kind: "tool" | "bed"; num: number; active: number; standby: number | null }) {
	const isBed = (): boolean => props.kind === "bed";
	return (
		<div class="heat-actions">
			<GcodeButton
				label="Active"
				variant="go"
				stamp={false}
				command={isBed() ? cmd.bedActive(props.num, props.active) : cmd.toolActive(props.num, props.active)}
			/>
			<Show when={!isBed() && props.standby !== null}>
				<GcodeButton label="Standby" stamp={false} command={cmd.toolStandby(props.num, props.standby ?? 0)} />
			</Show>
			<GcodeButton
				label="Off"
				variant="danger"
				stamp={false}
				command={isBed() ? cmd.bedOff(props.num) : cmd.toolOff(props.num)}
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
